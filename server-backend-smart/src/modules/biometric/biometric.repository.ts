import { Injectable } from '@nestjs/common';
import { BiometricKey, Employee, FaceProfileStatus, Prisma } from '@prisma/client';
import { BaseRepository } from 'src/infra/prisma/base.repository';
import { PrismaService } from 'src/infra/prisma/prisma.service';

export interface FaceProfileRow {
  companyId: string;
  employeeId: string;
  embeddingRaw: Buffer;
  embeddingDim: number;
  modelVersion: string;
  qualityScore: number | null;
  photoKey: string | null;
  angle: string;
}

export type EnrolledFaceProfile = Pick<
  Prisma.FaceProfileGetPayload<true>,
  'id' | 'angle' | 'modelVersion' | 'enrolledAt'
>;

export type ActiveBiometricKey = Pick<BiometricKey, 'id' | 'deviceId' | 'algorithm' | 'createdAt'>;

export interface RegisterFingerprintData {
  companyId: string;
  deviceId: string;
  publicKey: string;
  algorithm: string;
  attestation?: Prisma.InputJsonValue;
}

export interface RevokeFaceData {
  revokedAt: Date;
  revokedBy: string | null;
  revokedReason: string;
}

/**
 * Truy cập dữ liệu sinh trắc học: `face_profile` và `biometric_key`.
 *
 * BR-05 / NFR-SEC-07 — KHÔNG có phương thức nào ghi template vân tay, vì hệ thống
 * không nhận template. `biometric_key` chỉ chứa PUBLIC KEY do secure enclave cấp;
 * khoá riêng không rời khỏi thiết bị.
 *
 * `faceProfile` không bao giờ bị xoá cứng ở đây: đăng ký đè chuyển sang
 * `REPLACED`, reset chuyển sang `REVOKED`. Dọn ảnh là việc của
 * `RetentionProcessor`, và chỉ dọn ẢNH chứ không dọn bản ghi.
 */
@Injectable()
export class BiometricRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ===========================================================================
  //  Nhân viên (ngữ cảnh của mọi thao tác sinh trắc học)
  // ===========================================================================

  async findEmployee(companyId: string, employeeId: string): Promise<Employee | null> {
    return this.db().employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
  }

  async findEmployeeCode(companyId: string, employeeId: string): Promise<string | null> {
    const employee = await this.db().employee.findFirst({
      where: { id: employeeId, companyId },
      select: { employeeCode: true },
    });
    return employee?.employeeCode ?? null;
  }

  /** BR-03 — có phương thức xác thực rồi thì hồ sơ chuyển sang ACTIVE. */
  async activateIfPending(
    companyId: string,
    employeeId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.db(tx).employee.updateMany({
      where: { id: employeeId, companyId, status: 'PENDING_ACTIVATION' },
      data: { status: 'ACTIVE' },
    });
  }

  // ===========================================================================
  //  Hồ sơ khuôn mặt
  // ===========================================================================

  async countActiveFaceProfiles(companyId: string, employeeId: string): Promise<number> {
    return this.db().faceProfile.count({
      where: { companyId, employeeId, status: FaceProfileStatus.ACTIVE },
    });
  }

  async listActiveFaceProfiles(
    companyId: string,
    employeeId: string,
  ): Promise<EnrolledFaceProfile[]> {
    return this.db().faceProfile.findMany({
      where: { companyId, employeeId, status: FaceProfileStatus.ACTIVE },
      select: { id: true, angle: true, modelVersion: true, enrolledAt: true },
    });
  }

  /**
   * BR-10 — embedding đang hoạt động của MỌI nhân viên khác trong công ty.
   *
   * Dùng để so khớp 1:N chống trùng danh tính. Phạm vi dừng ở `companyId`: hai
   * công ty khác nhau có quyền có hai hồ sơ cùng khuôn mặt (một người làm hai nơi).
   */
  async findOtherActiveEmbeddings(
    companyId: string,
    employeeId: string,
  ): Promise<Array<{ employeeId: string; embeddingRaw: Buffer | null }>> {
    return this.db().faceProfile.findMany({
      where: {
        companyId,
        status: FaceProfileStatus.ACTIVE,
        employeeId: { not: employeeId },
      },
      select: { employeeId: true, embeddingRaw: true },
    });
  }

  /** Đăng ký đè: hồ sơ cũ thành REPLACED, KHÔNG xoá để giữ dấu vết. */
  async markProfilesReplaced(
    companyId: string,
    employeeId: string,
    replacedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).faceProfile.updateMany({
      where: { companyId, employeeId, status: FaceProfileStatus.ACTIVE },
      data: { status: FaceProfileStatus.REPLACED, revokedAt: replacedAt },
    });
    return result.count;
  }

  async createFaceProfiles(rows: FaceProfileRow[], tx?: Prisma.TransactionClient): Promise<number> {
    const result = await this.db(tx).faceProfile.createMany({
      data: rows.map((row) => ({ ...row, status: FaceProfileStatus.ACTIVE })),
    });
    return result.count;
  }

  async revokeFaceProfiles(
    companyId: string,
    employeeId: string,
    data: RevokeFaceData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).faceProfile.updateMany({
      where: { companyId, employeeId, status: FaceProfileStatus.ACTIVE },
      data: { status: FaceProfileStatus.REVOKED, ...data },
    });
    return result.count;
  }

  // ===========================================================================
  //  Khoá vân tay (public key)
  // ===========================================================================

  async findFingerprintKey(
    companyId: string,
    employeeId: string,
    deviceId: string,
  ): Promise<Pick<BiometricKey, 'publicKey' | 'revokedAt'> | null> {
    return this.db().biometricKey.findFirst({
      where: { companyId, employeeId, deviceId },
      select: { publicKey: true, revokedAt: true },
    });
  }

  async listActiveFingerprintKeys(
    companyId: string,
    employeeId: string,
  ): Promise<ActiveBiometricKey[]> {
    return this.db().biometricKey.findMany({
      where: { companyId, employeeId, revokedAt: null },
      select: { id: true, deviceId: true, algorithm: true, createdAt: true },
    });
  }

  async upsertFingerprintKey(
    employeeId: string,
    data: RegisterFingerprintData,
    tx?: Prisma.TransactionClient,
  ): Promise<BiometricKey> {
    const { companyId, deviceId, publicKey, algorithm, attestation } = data;
    return this.db(tx).biometricKey.upsert({
      where: { employeeId_deviceId: { employeeId, deviceId } },
      create: { companyId, employeeId, deviceId, publicKey, algorithm, attestation },
      update: { publicKey, algorithm, attestation, revokedAt: null, revokedReason: null },
    });
  }

  async revokeFingerprintKeys(
    companyId: string,
    employeeId: string,
    revokedAt: Date,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await this.db(tx).biometricKey.updateMany({
      where: { companyId, employeeId, revokedAt: null },
      data: { revokedAt, revokedReason: reason },
    });
    return result.count;
  }
}
