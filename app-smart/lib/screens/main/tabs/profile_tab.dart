import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';

class ProfileTab extends StatelessWidget {
  const ProfileTab({super.key});

  static const List<_ProfileMenuItem> _menuItems = [
    _ProfileMenuItem(
      icon: Icons.person_outline,
      label: 'Thông tin tài khoản',
    ),
    _ProfileMenuItem(
      icon: Icons.face_retouching_natural,
      label: 'Quản lý khuôn mặt',
    ),
    _ProfileMenuItem(
      icon: Icons.notifications_outlined,
      label: 'Cài đặt thông báo',
    ),
    _ProfileMenuItem(
      icon: Icons.language_outlined,
      label: 'Cài đặt ngôn ngữ',
    ),
    _ProfileMenuItem(
      icon: Icons.display_settings_outlined,
      label: 'Cài đặt hiển thị',
    ),
    _ProfileMenuItem(
      icon: Icons.lock_outline,
      label: 'Đổi mật khẩu',
    ),
    _ProfileMenuItem(
      icon: Icons.info_outline,
      label: 'Giới thiệu ứng dụng',
    ),
  ];

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
          'SmartFace Profile',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontWeight: FontWeight.bold,
            fontSize: 18,
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
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
        child: Column(
          children: [
            // Profile card
            Container(
              padding: const EdgeInsets.symmetric(vertical: 24, horizontal: 20),
              decoration: BoxDecoration(
                color: AppColors.cardWhite,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.06),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: Column(
                children: [
                  // Avatar
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.grey.shade300,
                      border: Border.all(
                        color: AppColors.primaryDarkGreen,
                        width: 2.5,
                      ),
                    ),
                    child: const Icon(Icons.person, color: Colors.white, size: 44),
                  ),
                  const SizedBox(height: 12),
                  // Name
                  const Text(
                    'Đức Nguyễn',
                    style: TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Chips row
                  Wrap(
                    spacing: 8,
                    children: [
                      _ProfileChip(label: 'ID: SF-1234', color: AppColors.textSecondary),
                      _ProfileChip(
                        label: 'Phòng Kỹ Thuật',
                        color: AppColors.primaryDarkGreen,
                        textColor: AppColors.primaryDarkGreen,
                        bgColor: AppColors.primaryDarkGreen.withValues(alpha: 0.1),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Menu list
            Container(
              decoration: BoxDecoration(
                color: AppColors.cardWhite,
                borderRadius: BorderRadius.circular(16),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Column(
                children: List.generate(_menuItems.length, (i) {
                  return Column(
                    children: [
                      _MenuListItem(item: _menuItems[i]),
                      if (i < _menuItems.length - 1)
                        const Divider(
                          height: 1,
                          indent: 60,
                          endIndent: 16,
                          color: AppColors.divider,
                        ),
                    ],
                  );
                }),
              ),
            ),
            const SizedBox(height: 24),

            // Logout button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {
                  Navigator.pushReplacementNamed(context, '/company_setup');
                },
                icon: const Icon(Icons.logout, color: AppColors.statusRejected, size: 20),
                label: const Text(
                  'Đăng xuất',
                  style: TextStyle(
                    color: AppColors.statusRejected,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: const BorderSide(color: AppColors.statusRejected, width: 1.5),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

class _ProfileMenuItem {
  final IconData icon;
  final String label;
  const _ProfileMenuItem({required this.icon, required this.label});
}

class _ProfileChip extends StatelessWidget {
  final String label;
  final Color color;
  final Color? textColor;
  final Color? bgColor;

  const _ProfileChip({
    required this.label,
    required this.color,
    this.textColor,
    this.bgColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: bgColor ?? AppColors.background,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: textColor ?? AppColors.textSecondary,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _MenuListItem extends StatelessWidget {
  final _ProfileMenuItem item;
  const _MenuListItem({required this.item});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {},
      borderRadius: BorderRadius.circular(0),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        child: Row(
          children: [
            // Icon container (teal circle)
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: AppColors.iconBg.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(item.icon, color: AppColors.iconBg, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Text(
                item.label,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const Icon(
              Icons.arrow_forward_ios,
              color: AppColors.textSecondary,
              size: 15,
            ),
          ],
        ),
      ),
    );
  }
}
