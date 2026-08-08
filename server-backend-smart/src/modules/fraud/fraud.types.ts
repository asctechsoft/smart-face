import { AttendanceDecision } from '@prisma/client';

/** Mã cờ nghi vấn — dùng chung giữa evaluate realtime và job quét nền. */
export const FraudCodes = {
  MOCK_LOCATION: 'MOCK_LOCATION',
  ROOTED_DEVICE: 'ROOTED_DEVICE',
  ATTESTATION_FAILED: 'ATTESTATION_FAILED',
  CLOCK_SKEW: 'CLOCK_SKEW',
  CLOCK_TAMPERING: 'CLOCK_TAMPERING',
  UNKNOWN_DEVICE: 'UNKNOWN_DEVICE',
  IMPOSSIBLE_TRAVEL: 'IMPOSSIBLE_TRAVEL',
  SUSPICIOUS_TRAVEL: 'SUSPICIOUS_TRAVEL',
  MULTI_DEVICE_ANOMALY: 'MULTI_DEVICE_ANOMALY',
  LOW_LIVENESS: 'LOW_LIVENESS',
  BORDERLINE_MATCH: 'BORDERLINE_MATCH',
  OUT_OF_GEOFENCE: 'OUT_OF_GEOFENCE',
  LOW_GPS_ACCURACY: 'LOW_GPS_ACCURACY',
  MISSING_LOCAL_NETWORK: 'MISSING_LOCAL_NETWORK',
  IDENTICAL_COORDINATE: 'IDENTICAL_COORDINATE',
  SHORT_ATTENDANCE: 'SHORT_ATTENDANCE',
  MISSING_CHECKOUT: 'MISSING_CHECKOUT',
  ABSENT_DURING_SHIFT: 'ABSENT_DURING_SHIFT',
  LOW_SIMILARITY_AUDIT: 'LOW_SIMILARITY_AUDIT',
} as const;

export type FraudCode = (typeof FraudCodes)[keyof typeof FraudCodes];

export type FraudSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FraudSignal {
  code: FraudCode;
  severity: FraudSeverity;
  score: number;
  message: string;
  details?: Record<string, unknown>;
}

/** Đầu vào để chấm điểm rủi ro một lượt chấm công. */
export interface FraudEvaluationInput {
  companyId: string;
  employeeId: string;
  userId: string;
  deviceId?: string | null;

  /** Vị trí */
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracy?: number | null;
  locationProvider?: string | null;
  isMockLocation: boolean;
  insideGeofence?: boolean | null;
  distanceToBranchM?: number | null;
  branchHasLocalNetworkConfig: boolean;
  matchedLocalNetwork: boolean;

  /** Thiết bị */
  isRootedDevice: boolean;
  attestationPassed?: boolean | null;
  isKnownDevice: boolean;

  /** Thời gian */
  clockSkewSeconds?: number | null;

  /** Kết quả AI */
  matchScore?: number | null;
  livenessScore?: number | null;

  recordedAt: Date;
}

export interface FraudEvaluationResult {
  score: number;
  signals: FraudSignal[];
  decision: AttendanceDecision;
  /** Mã lỗi nên trả về khi decision = REJECTED */
  rejectionCode?: string;
  thresholds: { flag: number; pendingReview: number; reject: number };
}
