import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class LeavesTab extends StatefulWidget {
  const LeavesTab({super.key});

  @override
  State<LeavesTab> createState() => _LeavesTabState();
}

class _LeavesTabState extends State<LeavesTab> {
  int _selectedLeaveType = 0;
  int _selectedFilterTab = 0;
  final TextEditingController _searchController = TextEditingController();

  final List<_LeaveType> _leaveTypes = const [
    _LeaveType(icon: Icons.calendar_today_outlined, label: 'Xin phép năm'),
    _LeaveType(icon: Icons.exit_to_app_outlined, label: 'Xin ra ngoài'),
    _LeaveType(icon: Icons.arrow_back_outlined, label: 'Về sớm'),
    _LeaveType(icon: Icons.money_off_outlined, label: 'Nghỉ không lương'),
    _LeaveType(icon: Icons.more_time_outlined, label: 'Tăng ca'),
    _LeaveType(icon: Icons.pregnant_woman_outlined, label: 'Nghỉ thai sản'),
    _LeaveType(icon: Icons.favorite_outline, label: 'Nghỉ kết hôn'),
    _LeaveType(icon: Icons.sentiment_very_dissatisfied_outlined, label: 'Nghỉ tang'),
  ];

  final List<_LeaveItem> _leaveItems = const [
    _LeaveItem(
      statusDot: AppColors.statusPending,
      type: 'Xin phép năm',
      badge: 'ĐANG CHỜ',
      badgeColor: AppColors.statusPending,
      date: '24/10/2023 - 25/10/2023',
      statusIcon: Icons.access_time,
    ),
    _LeaveItem(
      statusDot: AppColors.statusApproved,
      type: 'Xin ra ngoài',
      badge: 'ĐÃ DUYỆT',
      badgeColor: AppColors.statusApproved,
      date: '15/10/2023 (14:00 - 16:00)',
      statusIcon: Icons.check_circle_outline,
    ),
    _LeaveItem(
      statusDot: AppColors.statusRejected,
      type: 'Tăng ca',
      badge: 'BỊ TỪ CHỐI',
      badgeColor: AppColors.statusRejected,
      date: '10/10/2023',
      statusIcon: Icons.cancel_outlined,
    ),
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.cardWhite,
        elevation: 0,
        automaticallyImplyLeading: false,
        title: const Text(
          'SmartFace',
          style: TextStyle(
            color: AppColors.primaryDarkGreen,
            fontWeight: FontWeight.bold,
            fontSize: 20,
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
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Đơn từ',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),

            // Stats row
            Row(
              children: [
                Expanded(child: _StatBadge(count: '5', label: 'ĐANG CHỜ', color: AppColors.statusPending)),
                const SizedBox(width: 10),
                Expanded(child: _StatBadge(count: '12', label: 'ĐÃ DUYỆT', color: AppColors.statusApproved)),
                const SizedBox(width: 10),
                Expanded(child: _StatBadge(count: '1', label: 'BỊ TỪ CHỐI', color: AppColors.statusRejected)),
              ],
            ),
            const SizedBox(height: 20),

            // Leave type section title
            const Text(
              'LOẠI ĐƠN',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 10),

            // Leave type grid
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 3.2,
              children: List.generate(_leaveTypes.length, (i) {
                final isSelected = _selectedLeaveType == i;
                return InkWell(
                  onTap: () => setState(() => _selectedLeaveType = i),
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? AppColors.primaryDarkGreen.withValues(alpha: 0.1)
                          : AppColors.cardWhite,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: isSelected
                            ? AppColors.primaryDarkGreen
                            : AppColors.divider,
                        width: isSelected ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _leaveTypes[i].icon,
                          size: 16,
                          color: isSelected
                              ? AppColors.primaryDarkGreen
                              : AppColors.textSecondary,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            _leaveTypes[i].label,
                            style: TextStyle(
                              color: isSelected
                                  ? AppColors.primaryDarkGreen
                                  : AppColors.textPrimary,
                              fontSize: 12,
                              fontWeight: isSelected
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
            const SizedBox(height: 20),

            // Search field
            TextField(
              controller: _searchController,
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
              decoration: InputDecoration(
                hintText: 'Tìm kiếm đơn từ...',
                hintStyle: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.6), fontSize: 14),
                prefixIcon: const Icon(Icons.search, color: AppColors.textSecondary, size: 20),
                filled: true,
                fillColor: AppColors.cardWhite,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.divider),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.divider),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(color: AppColors.primaryDarkGreen, width: 1.5),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Filter tabs
            _FilterTabs(
              tabs: const ['Tất cả', 'Đang chờ', 'Đã duyệt', 'Bị từ chối'],
              selected: _selectedFilterTab,
              onSelected: (i) => setState(() => _selectedFilterTab = i),
            ),
            const SizedBox(height: 20),

            // Recent leaves section
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'ĐƠN GẦN ĐÂY',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                  ),
                ),
                TextButton(
                  onPressed: () {},
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text(
                    'Xem tất cả',
                    style: TextStyle(
                      color: AppColors.primaryDarkGreen,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // Leave items list
            Container(
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
                children: List.generate(_leaveItems.length, (i) {
                  final item = _leaveItems[i];
                  return Column(
                    children: [
                      _LeaveItemRow(item: item),
                      if (i < _leaveItems.length - 1)
                        const Divider(height: 1, indent: 16, endIndent: 16, color: AppColors.divider),
                    ],
                  );
                }),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        backgroundColor: AppColors.primaryDarkGreen,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }
}

class _LeaveType {
  final IconData icon;
  final String label;
  const _LeaveType({required this.icon, required this.label});
}

class _LeaveItem {
  final Color statusDot;
  final String type;
  final String badge;
  final Color badgeColor;
  final String date;
  final IconData statusIcon;

  const _LeaveItem({
    required this.statusDot,
    required this.type,
    required this.badge,
    required this.badgeColor,
    required this.date,
    required this.statusIcon,
  });
}

class _StatBadge extends StatelessWidget {
  final String count;
  final String label;
  final Color color;

  const _StatBadge({required this.count, required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        children: [
          Text(
            count,
            style: TextStyle(
              color: color,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 9,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterTabs extends StatelessWidget {
  final List<String> tabs;
  final int selected;
  final ValueChanged<int> onSelected;

  const _FilterTabs({
    required this.tabs,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: List.generate(tabs.length, (i) {
          final isSelected = selected == i;
          return Padding(
            padding: EdgeInsets.only(right: i < tabs.length - 1 ? 8 : 0),
            child: GestureDetector(
              onTap: () => onSelected(i),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: isSelected ? AppColors.primaryDarkGreen : AppColors.cardWhite,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isSelected ? AppColors.primaryDarkGreen : AppColors.divider,
                  ),
                ),
                child: Text(
                  tabs[i],
                  style: TextStyle(
                    color: isSelected ? Colors.white : AppColors.textSecondary,
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _LeaveItemRow extends StatelessWidget {
  final _LeaveItem item;
  const _LeaveItemRow({required this.item});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            margin: const EdgeInsets.only(right: 10),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: item.statusDot,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.type,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  item.date,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: item.badgeColor.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              item.badge,
              style: TextStyle(
                color: item.badgeColor,
                fontSize: 10,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.3,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
