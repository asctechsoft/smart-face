import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class SecuritySetupScreen extends StatefulWidget {
  const SecuritySetupScreen({super.key});

  @override
  State<SecuritySetupScreen> createState() => _SecuritySetupScreenState();
}

class _SecuritySetupScreenState extends State<SecuritySetupScreen> {
  bool _faceRegistered = false;
  bool _fingerprintActivated = false;

  int get _completedCount =>
      (_faceRegistered ? 1 : 0) + (_fingerprintActivated ? 1 : 0);

  void _showComingSoon(String method) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$method sẽ sớm được hỗ trợ trong phiên bản tiếp theo.'),
        backgroundColor: AppColors.primaryDarkGreen,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.primaryDarkGreen,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white, size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'Thiết lập bảo mật',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
        child: Column(
          children: [
            // Shield icon
            Container(
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.primaryDarkGreen.withValues(alpha: 0.12),
              ),
              child: const Icon(
                Icons.security,
                color: AppColors.primaryDarkGreen,
                size: 48,
              ),
            ),
            const SizedBox(height: 20),

            // Title
            const Text(
              'Đăng ký xác thực sinh trắc học',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 10),

            // Subtitle
            const Text(
              'Cần ít nhất 1 phương thức để chấm công',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 14,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),

            // Face card
            _BiometricOptionCard(
              icon: Icons.face_retouching_natural,
              title: 'Khuôn mặt',
              subtitle: 'Chụp 3 góc mặt để nhận diện AI',
              badgeText: 'Chưa đăng ký',
              onTap: () => _showComingSoon('Nhận diện khuôn mặt'),
            ),
            const SizedBox(height: 14),

            // Fingerprint card
            _BiometricOptionCard(
              icon: Icons.fingerprint,
              title: 'Vân tay',
              subtitle: 'Dùng cảm biến vân tay thiết bị',
              badgeText: 'Chưa kích hoạt',
              onTap: () => _showComingSoon('Quét vân tay'),
            ),
            const SizedBox(height: 28),

            // Progress section
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Tiến độ đăng ký',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    Text(
                      '$_completedCount/2 đã hoàn thành',
                      style: const TextStyle(
                        color: AppColors.primaryDarkGreen,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: _completedCount / 2,
                    minHeight: 8,
                    backgroundColor: AppColors.divider,
                    valueColor: const AlwaysStoppedAnimation<Color>(
                        AppColors.primaryDarkGreen),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 32),

            // Finish button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pushReplacementNamed(context, '/main');
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.goldButton,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 0,
                ),
                child: const Text(
                  'Hoàn tất',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Bạn có thể thiết lập sau trong mục Cài đặt',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BiometricOptionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String badgeText;
  final VoidCallback onTap;

  const _BiometricOptionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.badgeText,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.cardWhite,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: AppColors.primaryDarkGreen.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: AppColors.primaryDarkGreen, size: 28),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.orangeAccent.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      badgeText,
                      style: const TextStyle(
                        color: AppColors.orangeAccent,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.arrow_forward_ios,
              color: AppColors.textSecondary,
              size: 16,
            ),
          ],
        ),
      ),
    );
  }
}
