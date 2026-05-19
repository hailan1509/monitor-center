const CURRENT_WINDOW_MS = 5 * 60 * 1000;         // cửa sổ hiện tại: 5 phút
const HISTORY_MS = 60 * 60 * 1000;               // lịch sử tối đa: 1 giờ
const OLDER_WINDOWS = (HISTORY_MS - CURRENT_WINDOW_MS) / CURRENT_WINDOW_MS; // 11 cửa sổ 5-phút
const SPIKE_MULTIPLIER = 3;                       // 3x baseline = spike
const MIN_SPIKE_COUNT = 5;                        // ít nhất 5 errors để tính spike
const MIN_SPIKE_COUNT_NO_BASELINE = 10;           // khi chưa có baseline
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;        // 10 phút giữa các spike alert

export type SpikeResult = {
  isSpike: boolean;
  recentCount: number;
  baselineRate: number; // trung bình errors / 5 phút (dựa trên lịch sử)
};

class SpikeDetector {
  #timestamps = new Map<string, number[]>();
  #lastAlertAt = new Map<string, number>();

  record(project: string, service: string): SpikeResult {
    const key = `${project}::${service}`;
    const now = Date.now();

    let times = this.#timestamps.get(key) ?? [];
    times.push(now);
    times = times.filter((t) => now - t < HISTORY_MS);
    this.#timestamps.set(key, times);

    const recentCount = times.filter((t) => now - t < CURRENT_WINDOW_MS).length;
    const olderCount = times.length - recentCount;
    const baselineRate = olderCount / OLDER_WINDOWS;

    let isSpike: boolean;
    if (baselineRate < 1) {
      isSpike = recentCount >= MIN_SPIKE_COUNT_NO_BASELINE;
    } else {
      isSpike = recentCount >= MIN_SPIKE_COUNT && recentCount > baselineRate * SPIKE_MULTIPLIER;
    }

    if (isSpike) {
      const lastAlert = this.#lastAlertAt.get(key) ?? 0;
      if (now - lastAlert < ALERT_COOLDOWN_MS) {
        return { isSpike: false, recentCount, baselineRate };
      }
      this.#lastAlertAt.set(key, now);
    }

    return { isSpike, recentCount, baselineRate };
  }
}

export const spikeDetector = new SpikeDetector();
