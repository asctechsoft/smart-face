import { MemoryStore } from './redis.store';

/**
 * `MemoryStore` đứng thay Redis khi `REDIS_ENABLED=false`, và nó đỡ đúng những
 * chốt an toàn quan trọng: nonce chống replay (AF-12) và rate limit (AF-13).
 *
 * Phần lớn test dưới đây kiểm tra sự TRUNG THÀNH với ngữ nghĩa Redis, không phải
 * kiểm tra một `Map` có hoạt động không. Lý do: `RedisService` được viết cho hành
 * vi của Redis. Chệch một điểm nhỏ — ví dụ `INCR` làm mất hạn cũ — là bộ đếm rate
 * limit không bao giờ hết hạn, và người dùng bị khoá vĩnh viễn sau lần thứ N.
 * Loại lỗi đó không lộ ra ở môi trường có Redis thật, nên phải chặn tại đây.
 */
describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    jest.useFakeTimers();
    store = new MemoryStore();
    await store.connect();
  });

  afterEach(async () => {
    await store.close();
    jest.useRealTimers();
  });

  describe('setNx — nền tảng của nonce chống replay', () => {
    it('lần đầu chiếm được, lần sau bị từ chối', async () => {
      await expect(store.setNx('nonce:abc', '1', 60)).resolves.toBe(true);
      await expect(store.setNx('nonce:abc', '1', 60)).resolves.toBe(false);
    });

    it('chiếm lại được sau khi khoá hết hạn', async () => {
      await store.setNx('nonce:abc', '1', 60);
      jest.advanceTimersByTime(61_000);
      await expect(store.setNx('nonce:abc', '1', 60)).resolves.toBe(true);
    });
  });

  describe('incr — nền tảng của rate limit', () => {
    it('đếm tăng dần từ khoá chưa tồn tại', async () => {
      await expect(store.incr('rl:ip')).resolves.toBe(1);
      await expect(store.incr('rl:ip')).resolves.toBe(2);
      await expect(store.incr('rl:ip')).resolves.toBe(3);
    });

    it('KHÔNG làm mới hạn đã đặt', async () => {
      // Đây chính là hợp đồng mà `RedisService.incrementWithTtl` dựa vào: nó chỉ
      // gọi `expire` ở lần tăng đầu tiên. Nếu `incr` xoá hạn thì cửa sổ rate limit
      // không bao giờ đóng lại.
      await store.incr('rl:ip');
      await store.expire('rl:ip', 60);

      jest.advanceTimersByTime(30_000);
      await store.incr('rl:ip');
      await expect(store.ttl('rl:ip')).resolves.toBe(30);

      jest.advanceTimersByTime(31_000);
      await expect(store.get('rl:ip')).resolves.toBeNull();
    });
  });

  describe('ttl — theo đúng quy ước số âm của Redis', () => {
    it('trả -2 khi khoá không tồn tại', async () => {
      await expect(store.ttl('khong-co')).resolves.toBe(-2);
    });

    it('trả -1 khi khoá tồn tại nhưng không có hạn', async () => {
      await store.set('vinh-vien', 'x');
      await expect(store.ttl('vinh-vien')).resolves.toBe(-1);
    });

    it('trả số giây còn lại khi có hạn', async () => {
      await store.set('co-han', 'x', 100);
      jest.advanceTimersByTime(40_000);
      await expect(store.ttl('co-han')).resolves.toBe(60);
    });
  });

  describe('set / get', () => {
    it('ghi rồi đọc lại được', async () => {
      await store.set('k', 'v');
      await expect(store.get('k')).resolves.toBe('v');
    });

    it('khoá quá hạn coi như không tồn tại', async () => {
      await store.set('k', 'v', 10);
      jest.advanceTimersByTime(11_000);
      await expect(store.get('k')).resolves.toBeNull();
    });

    it('ghi đè không kèm hạn sẽ xoá hạn cũ, giống SET của Redis', async () => {
      await store.set('k', 'v', 10);
      await store.set('k', 'v2');
      await expect(store.ttl('k')).resolves.toBe(-1);
    });
  });

  describe('keysWithPrefix — dùng cho invalidatePrefix', () => {
    it('chỉ lấy khoá đúng tiền tố', async () => {
      await store.set('dash:c1:a', '1');
      await store.set('dash:c1:b', '1');
      await store.set('dash:c2:a', '1');

      const keys = await store.keysWithPrefix('dash:c1:');
      expect(keys.sort()).toEqual(['dash:c1:a', 'dash:c1:b']);
    });

    it('bỏ qua khoá đã quá hạn', async () => {
      await store.set('dash:c1:a', '1', 10);
      await store.set('dash:c1:b', '1');
      jest.advanceTimersByTime(11_000);

      await expect(store.keysWithPrefix('dash:c1:')).resolves.toEqual(['dash:c1:b']);
    });
  });

  it('del xoá nhiều khoá và bỏ qua khoá không tồn tại', async () => {
    await store.set('a', '1');
    await store.set('b', '1');

    await store.del(['a', 'b', 'khong-co']);

    await expect(store.get('a')).resolves.toBeNull();
    await expect(store.get('b')).resolves.toBeNull();
  });

  it('ping luôn thành công — không có gì để mất kết nối', async () => {
    await expect(store.ping()).resolves.toBe(true);
  });

  it('quét định kỳ dọn khoá quá hạn mà không ai còn chạm tới', async () => {
    // Đọc/ghi đã tự bỏ qua khoá quá hạn, nên lỗi thiếu bộ quét sẽ KHÔNG lộ ra
    // qua hành vi — chỉ lộ qua bộ nhớ phình dần. Vì vậy phải soi trực tiếp.
    await store.set('rac', 'x', 10);
    jest.advanceTimersByTime(120_000);

    const entries = store as unknown as { entries: Map<string, unknown> };
    expect(entries.entries.size).toBe(0);
  });

  it('mode báo đúng để health check không nói dối', () => {
    expect(store.mode).toBe('in-memory');
  });
});
