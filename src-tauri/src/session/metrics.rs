//! Read-only Linux host metrics collected over an authenticated SSH session.

use serde::Serialize;
use std::time::Duration;

/// Fixed command: it contains no profile or user supplied data and only reads
/// procfs plus the root filesystem summary.
pub const LINUX_METRICS_COMMAND: &str =
    "cat /proc/stat /proc/meminfo /proc/net/dev /proc/uptime; df -Pk /";
pub const MAX_METRICS_OUTPUT: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMetrics {
    pub cpu_percent: Option<f64>,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub network_rx_bytes_per_second: Option<f64>,
    pub network_tx_bytes_per_second: Option<f64>,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinuxSnapshot {
    cpu_total: u64,
    cpu_idle: u64,
    memory_available_bytes: u64,
    memory_total_bytes: u64,
    disk_used_bytes: u64,
    disk_total_bytes: u64,
    network_rx_bytes: u64,
    network_tx_bytes: u64,
    uptime_seconds: u64,
}

/// Parses the bounded output of [`LINUX_METRICS_COMMAND`]. Missing or malformed
/// sections make the sample unavailable instead of publishing partial data.
pub fn parse_linux_snapshot(output: &[u8]) -> Option<LinuxSnapshot> {
    if output.len() > MAX_METRICS_OUTPUT {
        return None;
    }
    let text = std::str::from_utf8(output).ok()?;
    let mut cpu_total = None;
    let mut cpu_idle = None;
    let mut memory_total_kib = None;
    let mut memory_available_kib = None;
    let mut disk_total_kib = None;
    let mut disk_used_kib = None;
    let mut network_rx_bytes = 0_u64;
    let mut network_tx_bytes = 0_u64;
    let mut has_network_interface = false;
    let mut uptime_seconds = None;
    let mut in_df = false;

    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("cpu ") {
            let values = rest
                .split_whitespace()
                .map(str::parse::<u64>)
                .collect::<Result<Vec<_>, _>>()
                .ok()?;
            if values.len() < 5 {
                return None;
            }
            // Guest time is already included in user/nice on Linux.
            let total = values.iter().take(8).copied().sum::<u64>();
            cpu_total = Some(total);
            cpu_idle = Some(values[3].saturating_add(values[4]));
            continue;
        }
        if let Some(value) = line.strip_prefix("MemTotal:") {
            memory_total_kib = value.split_whitespace().next()?.parse::<u64>().ok();
            continue;
        }
        if let Some(value) = line.strip_prefix("MemAvailable:") {
            memory_available_kib = value.split_whitespace().next()?.parse::<u64>().ok();
            continue;
        }
        if line.starts_with("Filesystem") {
            in_df = true;
            continue;
        }
        if in_df {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            if fields.len() >= 6 && fields.last() == Some(&"/") {
                disk_total_kib = fields[1].parse::<u64>().ok();
                disk_used_kib = fields[2].parse::<u64>().ok();
                in_df = false;
                continue;
            }
        }
        if let Some((interface, counters)) = line.split_once(':') {
            if interface.contains('|') || interface.trim().eq_ignore_ascii_case("lo") {
                continue;
            }
            let values = counters
                .split_whitespace()
                .map(str::parse::<u64>)
                .collect::<Result<Vec<_>, _>>()
                .ok()?;
            if values.len() < 9 {
                return None;
            }
            network_rx_bytes = network_rx_bytes.saturating_add(values[0]);
            network_tx_bytes = network_tx_bytes.saturating_add(values[8]);
            has_network_interface = true;
            continue;
        }
        let mut numbers = line.split_whitespace();
        if let (Some(first), Some(second), None) = (numbers.next(), numbers.next(), numbers.next())
        {
            if first.parse::<f64>().is_ok() && second.parse::<f64>().is_ok() {
                uptime_seconds = first.split('.').next()?.parse::<u64>().ok();
            }
        }
    }

    let memory_total_bytes = memory_total_kib?.saturating_mul(1024);
    let memory_available_bytes = memory_available_kib?.saturating_mul(1024);
    let disk_total_bytes = disk_total_kib?.saturating_mul(1024);
    Some(LinuxSnapshot {
        cpu_total: cpu_total?,
        cpu_idle: cpu_idle?,
        memory_available_bytes: memory_available_bytes.min(memory_total_bytes),
        memory_total_bytes,
        disk_used_bytes: disk_used_kib?.saturating_mul(1024).min(disk_total_bytes),
        disk_total_bytes,
        network_rx_bytes: has_network_interface.then_some(network_rx_bytes)?,
        network_tx_bytes: has_network_interface.then_some(network_tx_bytes)?,
        uptime_seconds: uptime_seconds?,
    })
}

pub fn calculate_metrics(
    previous: Option<LinuxSnapshot>,
    current: LinuxSnapshot,
    elapsed: Duration,
) -> HostMetrics {
    let cpu_percent = previous.and_then(|old| {
        let total = current.cpu_total.checked_sub(old.cpu_total)?;
        let idle = current.cpu_idle.checked_sub(old.cpu_idle)?;
        (total > 0)
            .then(|| ((total.saturating_sub(idle) as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
    });
    let seconds = elapsed.as_secs_f64();
    let rate = |now: u64, old: u64| {
        let delta = now.checked_sub(old)?;
        (seconds > 0.0).then_some(delta as f64 / seconds)
    };
    let network_rx_bytes_per_second =
        previous.and_then(|old| rate(current.network_rx_bytes, old.network_rx_bytes));
    let network_tx_bytes_per_second =
        previous.and_then(|old| rate(current.network_tx_bytes, old.network_tx_bytes));

    HostMetrics {
        cpu_percent,
        memory_used_bytes: current
            .memory_total_bytes
            .saturating_sub(current.memory_available_bytes),
        memory_total_bytes: current.memory_total_bytes,
        disk_used_bytes: current.disk_used_bytes,
        disk_total_bytes: current.disk_total_bytes,
        network_rx_bytes_per_second,
        network_tx_bytes_per_second,
        uptime_seconds: current.uptime_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "cpu 100 10 50 800 40 0 0 0 4 1\n\
MemTotal: 2048000 kB\n\
MemAvailable: 1024000 kB\n\
Inter-| Receive | Transmit\n\
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n\
  eth0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n\
    lo: 9999 0 0 0 0 0 0 0 9999 0 0 0 0 0 0 0\n\
12345.67 12.34\n\
Filesystem 1024-blocks Used Available Capacity Mounted on\n\
/dev/sda1 100000 25000 75000 25% /\n";

    #[test]
    fn parses_linux_proc_and_root_disk_sample() {
        let sample = parse_linux_snapshot(SAMPLE.as_bytes()).unwrap();
        let metrics = calculate_metrics(None, sample, Duration::from_secs(5));
        assert_eq!(metrics.memory_total_bytes, 2_097_152_000);
        assert_eq!(metrics.memory_used_bytes, 1_048_576_000);
        assert_eq!(metrics.disk_total_bytes, 102_400_000);
        assert_eq!(metrics.disk_used_bytes, 25_600_000);
        assert_eq!(metrics.uptime_seconds, 12_345);
        assert_eq!(metrics.cpu_percent, None);
        assert_eq!(metrics.network_rx_bytes_per_second, None);
        assert_eq!(sample.network_rx_bytes, 1_000);
        assert_eq!(sample.network_tx_bytes, 2_000);
    }

    #[test]
    fn calculates_cpu_and_network_rates_from_two_samples() {
        let first = parse_linux_snapshot(SAMPLE.as_bytes()).unwrap();
        let changed = SAMPLE
            .replace("cpu 100 10 50 800 40", "cpu 110 10 60 810 40")
            .replace("eth0: 1000", "eth0: 4000")
            .replace("0 0 0 0 0 0 0 0 2000", "0 0 0 0 0 0 0 0 8000");
        let second = parse_linux_snapshot(changed.as_bytes()).unwrap();
        let metrics = calculate_metrics(Some(first), second, Duration::from_secs(5));
        assert_eq!(metrics.cpu_percent, Some(66.66666666666666));
        assert_eq!(metrics.network_rx_bytes_per_second, Some(600.0));
        assert_eq!(metrics.network_tx_bytes_per_second, Some(1_200.0));
    }

    #[test]
    fn rejects_incomplete_or_oversized_output() {
        assert!(parse_linux_snapshot(b"not linux").is_none());
        assert!(parse_linux_snapshot(&vec![b'x'; MAX_METRICS_OUTPUT + 1]).is_none());
    }
}
