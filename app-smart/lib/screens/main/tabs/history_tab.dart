import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class HistoryTab extends StatefulWidget {
  const HistoryTab({super.key});

  @override
  State<HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<HistoryTab> {
  int _currentMonth = 6;
  int _currentYear = 2024;

  // Calendar data for June 2024 (starts on Saturday=day 6)
  // June 1 = Saturday
  static const List<Map<String, dynamic>> _calendarDays = [
    {'day': 1, 'status': 'off'},   // Sat
    {'day': 2, 'status': 'off'},   // Sun
    {'day': 3, 'status': 'ok'},
    {'day': 4, 'status': 'ok'},
    {'day': 5, 'status': 'ok'},
    {'day': 6, 'status': 'ok'},
    {'day': 7, 'status': 'ok'},
    {'day': 8, 'status': 'off'},
    {'day': 9, 'status': 'off'},
    {'day': 10, 'status': 'ok'},
    {'day': 11, 'status': 'ok'},
    {'day': 12, 'status': 'ok'},
    {'day': 13, 'status': 'ok'},
    {'day': 14, 'status': 'late'},
    {'day': 15, 'status': 'off'},
    {'day': 16, 'status': 'off'},
    {'day': 17, 'status': 'ok'},
    {'day': 18, 'status': 'ok'},
    {'day': 19, 'status': 'ot'},
    {'day': 20, 'status': 'ok'},
    {'day': 21, 'status': 'late'},
    {'day': 22, 'status': 'off'},
    {'day': 23, 'status': 'off'},
    {'day': 24, 'status': 'ok'},
    {'day': 25, 'status': 'ok'},
    {'day': 26, 'status': 'leave'},
    {'day': 27, 'status': 'ok'},
    {'day': 28, 'status': 'ok'},
    {'day': 29, 'status': 'off'},
    {'day': 30, 'status': 'off'},
  ];

  Color _statusColor(String status) {
    switch (status) {
      case 'ok':
        return AppColors.statusApproved;
      case 'late':
        return AppColors.statusPending;
      case 'leave':
        return AppColors.statusRejected;
      case 'ot':
        return Colors.grey.shade500;
      default:
        return Colors.transparent;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.cardWhite,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppColors.primaryDarkGreen, size: 20),
          onPressed: () {},
        ),
        title: const Text(
          'Báo cáo cá nhân',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 17,
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_outlined, color: AppColors.textSecondary),
            onPressed: () {},
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Green stats card
            _StatsCard(),
            const SizedBox(height: 16),

            // Calendar section
            _CalendarSection(
              month: _currentMonth,
              year: _currentYear,
              days: _calendarDays,
              statusColor: _statusColor,
              onPrev: () => setState(() {
                if (_currentMonth == 1) {
                  _currentMonth = 12;
                  _currentYear--;
                } else {
                  _currentMonth--;
                }
              }),
              onNext: () => setState(() {
                if (_currentMonth == 12) {
                  _currentMonth = 1;
                  _currentYear++;
                } else {
                  _currentMonth++;
                }
              }),
            ),
            const SizedBox(height: 16),

            // Detail section title
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Chi tiết tuần này',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.filter_list, color: AppColors.textSecondary, size: 22),
                  onPressed: () {},
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Daily records
            _DailyRecord(
              dateLabel: 'Hôm nay, 21 Tháng 6 - Thứ Sáu',
              badge: 'ĐI MUỘN',
              badgeColor: AppColors.statusPending,
              checkIn: '08:15',
              checkOut: '17:30',
              total: '8h 15m',
              overtime: null,
            ),
            const SizedBox(height: 10),
            _DailyRecord(
              dateLabel: '20 Tháng 6 - Thứ Năm',
              badge: 'ĐÚNG GIỜ',
              badgeColor: AppColors.statusApproved,
              checkIn: '07:55',
              checkOut: '17:05',
              total: '8h 10m',
              overtime: null,
            ),
            const SizedBox(height: 10),
            _DailyRecord(
              dateLabel: '19 Tháng 6 - Thứ Tư',
              badge: 'ĐANG TĂNG CA',
              badgeColor: AppColors.statusOvertime,
              checkIn: '08:00',
              checkOut: '20:30',
              total: '11h 30m',
              overtime: 'OT 2.5h',
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.primaryDarkGreen,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'THÁNG 6, 2024',
            style: TextStyle(
              color: Colors.white60,
              fontSize: 11,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Expanded(
                child: Text(
                  'Tổng quan',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              // Circular progress
              SizedBox(
                width: 60,
                height: 60,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    CircularProgressIndicator(
                      value: 0.95,
                      strokeWidth: 5,
                      backgroundColor: Colors.white30,
                      valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                    const Text(
                      '95%',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(color: Colors.white24, height: 1),
          const SizedBox(height: 12),
          Row(
            children: [
              _StatItem(label: 'Tổng giờ làm', value: '168/176h', icon: Icons.access_time_outlined),
              const SizedBox(width: 20),
              _StatItem(label: 'Đi muộn', value: '2 lần', icon: Icons.arrow_upward_outlined),
              const SizedBox(width: 20),
              _StatItem(label: 'Về sớm', value: '0 lần', icon: Icons.arrow_downward_outlined),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _StatItem({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: Colors.white60, size: 13),
              const SizedBox(width: 4),
              Text(
                label,
                style: const TextStyle(color: Colors.white60, fontSize: 10),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

class _CalendarSection extends StatelessWidget {
  final int month;
  final int year;
  final List<Map<String, dynamic>> days;
  final Color Function(String) statusColor;
  final VoidCallback onPrev;
  final VoidCallback onNext;

  const _CalendarSection({
    required this.month,
    required this.year,
    required this.days,
    required this.statusColor,
    required this.onPrev,
    required this.onNext,
  });

  static const List<String> _dayHeaders = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  static const List<String> _monthNames = [
    '', 'Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12',
  ];

  @override
  Widget build(BuildContext context) {
    // June 2024: first day is Saturday (index 5 in Mon-Sun) -> 5 empty cells
    // June 1, 2024 is a Saturday
    final int startOffset = 5; // 0=Mon, 5=Sat
    final int totalDays = 30;
    final int totalCells = startOffset + totalDays;
    final int rows = (totalCells / 7).ceil();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardWhite,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Header row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left, color: AppColors.textSecondary),
                onPressed: onPrev,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
              Text(
                'Lịch biểu ${_monthNames[month]}',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right, color: AppColors.textSecondary),
                onPressed: onNext,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Day headers
          Row(
            children: _dayHeaders.map((h) {
              return Expanded(
                child: Center(
                  child: Text(
                    h,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 6),
          // Calendar grid
          for (int row = 0; row < rows; row++)
            Row(
              children: List.generate(7, (col) {
                final int cellIndex = row * 7 + col;
                final int dayNum = cellIndex - startOffset + 1;
                if (dayNum < 1 || dayNum > totalDays) {
                  return const Expanded(child: SizedBox(height: 36));
                }
                final String status = days[dayNum - 1]['status'] as String;
                final Color dotColor = statusColor(status);
                final bool isToday = dayNum == 21;

                return Expanded(
                  child: Container(
                    height: 36,
                    margin: const EdgeInsets.symmetric(vertical: 2),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 24,
                          height: 24,
                          decoration: isToday
                              ? const BoxDecoration(
                                  color: AppColors.primaryDarkGreen,
                                  shape: BoxShape.circle,
                                )
                              : null,
                          child: Center(
                            child: Text(
                              '$dayNum',
                              style: TextStyle(
                                color: isToday ? Colors.white : AppColors.textPrimary,
                                fontSize: 11,
                                fontWeight: isToday ? FontWeight.bold : FontWeight.normal,
                              ),
                            ),
                          ),
                        ),
                        if (dotColor != Colors.transparent)
                          Container(
                            width: 5,
                            height: 5,
                            margin: const EdgeInsets.only(top: 2),
                            decoration: BoxDecoration(
                              color: dotColor,
                              shape: BoxShape.circle,
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              }),
            ),
          const SizedBox(height: 12),
          // Legend
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _LegendItem(color: AppColors.statusApproved, label: 'Đúng giờ'),
              _LegendItem(color: AppColors.statusPending, label: 'Đi muộn/Về sớm'),
              _LegendItem(color: AppColors.statusRejected, label: 'Nghỉ phép'),
              _LegendItem(color: Colors.grey.shade500, label: 'Tăng ca'),
            ],
          ),
        ],
      ),
    );
  }
}

class _LegendItem extends StatelessWidget {
  final Color color;
  final String label;
  const _LegendItem({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 9.5)),
      ],
    );
  }
}

class _DailyRecord extends StatelessWidget {
  final String dateLabel;
  final String badge;
  final Color badgeColor;
  final String checkIn;
  final String checkOut;
  final String total;
  final String? overtime;

  const _DailyRecord({
    required this.dateLabel,
    required this.badge,
    required this.badgeColor,
    required this.checkIn,
    required this.checkOut,
    required this.total,
    this.overtime,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardWhite,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Date row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                dateLabel,
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: badgeColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  badge,
                  style: TextStyle(
                    color: badgeColor,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Divider(height: 1, color: AppColors.divider),
          const SizedBox(height: 10),
          // Check in/out row
          Row(
            children: [
              _TimeItem(label: 'VÀO', time: checkIn, color: AppColors.statusApproved),
              const SizedBox(width: 20),
              _TimeItem(label: 'RA', time: checkOut, color: AppColors.statusRejected),
              const Spacer(),
              if (overtime != null)
                Padding(
                  padding: const EdgeInsets.only(right: 16),
                  child: _TimeItem(label: 'OT', time: overtime!, color: AppColors.statusOvertime),
                ),
              _TimeItem(label: 'TỔNG', time: total, color: AppColors.primaryDarkGreen),
            ],
          ),
        ],
      ),
    );
  }
}

class _TimeItem extends StatelessWidget {
  final String label;
  final String time;
  final Color color;

  const _TimeItem({required this.label, required this.time, required this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          time,
          style: TextStyle(
            color: color,
            fontSize: 14,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}
