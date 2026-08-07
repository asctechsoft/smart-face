import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class HomeTab extends StatelessWidget {
  const HomeTab({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          // Green header
          _HomeHeader(),
          // Scrollable content
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                children: [
                  // White rounded top content
                  Container(
                    decoration: const BoxDecoration(
                      color: AppColors.background,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 16),
                        // Clock card
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _ClockCard(),
                        ),
                        const SizedBox(height: 16),
                        // Quick actions
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _QuickActionsGrid(),
                        ),
                        const SizedBox(height: 16),
                        // Pending approval banner
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _PendingApprovalBanner(),
                        ),
                        const SizedBox(height: 16),
                        // Weekly schedule
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _WeeklySchedule(),
                        ),
                        const SizedBox(height: 16),
                        // Stats row
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _StatsRow(),
                        ),
                        const SizedBox(height: 12),
                        // Second stats row
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _SecondStatsRow(),
                        ),
                        const SizedBox(height: 16),
                        // Holiday banner
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _HolidayBanner(),
                        ),
                        const SizedBox(height: 24),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HomeHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.greenHeaderBg,
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 12,
        left: 16,
        right: 16,
        bottom: 16,
      ),
      child: Column(
        children: [
          Row(
            children: [
              // Avatar
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.grey.shade400,
                  border: Border.all(color: Colors.white, width: 2),
                ),
                child: const Icon(Icons.person, color: Colors.white, size: 28),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Chào buổi sáng,',
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                    const Text(
                      'Đức Nguyễn',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              // Weather
              Row(
                children: [
                  const Icon(Icons.wb_sunny_outlined, color: Colors.white70, size: 18),
                  const SizedBox(width: 4),
                  const Text(
                    '31°',
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                ],
              ),
              const SizedBox(width: 12),
              // Notification bell
              Stack(
                clipBehavior: Clip.none,
                children: [
                  IconButton(
                    icon: const Icon(Icons.notifications_outlined, color: Colors.white),
                    onPressed: () {},
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                  Positioned(
                    top: -4,
                    right: -4,
                    child: Container(
                      width: 16,
                      height: 16,
                      decoration: const BoxDecoration(
                        color: AppColors.orangeAccent,
                        shape: BoxShape.circle,
                      ),
                      child: const Center(
                        child: Text(
                          '2',
                          style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(Icons.calendar_today_outlined, color: Colors.white70, size: 16),
              const SizedBox(width: 6),
              const Text(
                'Thứ 2, 14/10/2026 · Ca HC 08:00–17:30',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ClockCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.cardWhite,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Status chip
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.orangeAccent.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Text(
              'Chưa chấm vào',
              style: TextStyle(
                color: AppColors.orangeAccent,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 12),
          // Clock
          const Text(
            '16:51:35',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 42,
              fontWeight: FontWeight.bold,
              letterSpacing: 2,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 10),
          // Location
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.location_on, color: AppColors.primaryDarkGreen, size: 16),
              const SizedBox(width: 4),
              const Text(
                'VP AMOBI · trong khu vực · cách tâm 18m',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          // Check-in button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {},
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.goldButton,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.back_hand_outlined, size: 20),
                  SizedBox(width: 8),
                  Text(
                    'CHẤM VÀO',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.8,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text(
                'Hoặc dùng vân tay ',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
              ),
              Icon(Icons.fingerprint, color: AppColors.textSecondary.withValues(alpha: 0.7), size: 16),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuickActionsGrid extends StatelessWidget {
  final List<_QuickAction> _actions = const [
    _QuickAction(icon: Icons.edit_note_outlined, label: 'Xin ra ngoài'),
    _QuickAction(icon: Icons.assignment_outlined, label: 'Tạo đơn'),
    _QuickAction(icon: Icons.bar_chart_outlined, label: 'Công tháng'),
    _QuickAction(icon: Icons.calendar_month_outlined, label: 'Lịch ca'),
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Thao tác nhanh',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 0.85,
          children: _actions.map((a) => _QuickActionCard(action: a)).toList(),
        ),
      ],
    );
  }
}

class _QuickAction {
  final IconData icon;
  final String label;
  const _QuickAction({required this.icon, required this.label});
}

class _QuickActionCard extends StatelessWidget {
  final _QuickAction action;
  const _QuickActionCard({required this.action});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {},
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.cardWhite,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.primaryDarkGreen.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(action.icon, color: AppColors.primaryDarkGreen, size: 22),
            ),
            const SizedBox(height: 6),
            Text(
              action.label,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 10.5,
                fontWeight: FontWeight.w500,
              ),
              textAlign: TextAlign.center,
              maxLines: 2,
            ),
          ],
        ),
      ),
    );
  }
}

class _PendingApprovalBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFDE68A)),
      ),
      child: Row(
        children: [
          const Icon(Icons.access_time, color: AppColors.goldButton, size: 22),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '1 đơn đang chờ duyệt',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Xin ra ngoài 14:00 - 15:30',
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const Icon(Icons.arrow_forward_ios, color: AppColors.textSecondary, size: 14),
        ],
      ),
    );
  }
}

class _WeeklySchedule extends StatelessWidget {
  final List<Map<String, dynamic>> _days = const [
    {'label': 'T2', 'hours': '8h', 'done': true, 'today': false},
    {'label': 'T3', 'hours': '8h', 'done': true, 'today': false},
    {'label': 'T4', 'hours': '8h', 'done': true, 'today': false},
    {'label': 'T5', 'hours': '8h', 'done': true, 'today': false},
    {'label': 'T6', 'hours': '8h', 'done': false, 'today': true},
    {'label': 'T7', 'hours': '4h', 'done': false, 'today': false},
    {'label': 'CN', 'hours': '-', 'done': false, 'today': false},
  ];

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
          const Text(
            'Lịch làm việc tuần',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: _days.map((day) {
              final bool isToday = day['today'] as bool;
              final bool isDone = day['done'] as bool;
              return Column(
                children: [
                  Text(
                    day['hours'] as String,
                    style: TextStyle(
                      color: isToday ? AppColors.primaryDarkGreen : AppColors.textSecondary,
                      fontSize: 11,
                      fontWeight: isToday ? FontWeight.w600 : FontWeight.normal,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isToday ? AppColors.primaryDarkGreen : Colors.transparent,
                      border: isToday
                          ? null
                          : isDone
                              ? Border.all(color: AppColors.divider)
                              : null,
                    ),
                    child: Center(
                      child: isDone && !isToday
                          ? const Icon(Icons.check, size: 16, color: AppColors.primaryDarkGreen)
                          : Text(
                              day['label'] as String,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: isToday ? Colors.white : AppColors.textSecondary,
                              ),
                            ),
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}

class _StatsRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Green card
        Expanded(
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.primaryDarkGreen,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CÔNG THÁNG 10',
                  style: TextStyle(color: Colors.white70, fontSize: 10, letterSpacing: 0.8),
                ),
                SizedBox(height: 6),
                Text(
                  '168h/176h',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 2),
                Text(
                  'Đạt 95%',
                  style: TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        // White card
        Expanded(
          child: Container(
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
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ĐI MUỘN',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 10, letterSpacing: 0.8),
                ),
                SizedBox(height: 6),
                Text(
                  '2 Lần',
                  style: TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.bold),
                ),
                SizedBox(height: 2),
                Text(
                  'Trong tháng 10',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SecondStatsRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _SmallStatCard(
            icon: Icons.content_cut_outlined,
            iconColor: AppColors.primaryDarkGreen,
            title: 'Phép năm còn',
            value: '8 ngày',
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _SmallStatCard(
            icon: Icons.more_time_outlined,
            iconColor: AppColors.goldButton,
            title: 'OT đã duyệt',
            value: '12h',
          ),
        ),
      ],
    );
  }
}

class _SmallStatCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String value;

  const _SmallStatCard({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
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
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: iconColor, size: 20),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 10.5),
                ),
                Text(
                  value,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HolidayBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.primaryDarkGreen.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primaryDarkGreen.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.campaign_outlined, color: AppColors.primaryDarkGreen, size: 24),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Nghỉ lễ Quốc khánh',
                  style: TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  'Còn 64 ngày · nghỉ 02-03/09',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          const Icon(Icons.arrow_forward_ios, color: AppColors.textSecondary, size: 14),
        ],
      ),
    );
  }
}
