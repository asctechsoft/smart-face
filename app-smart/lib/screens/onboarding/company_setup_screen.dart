import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class CompanySetupScreen extends StatefulWidget {
  const CompanySetupScreen({super.key});

  @override
  State<CompanySetupScreen> createState() => _CompanySetupScreenState();
}

class _CompanySetupScreenState extends State<CompanySetupScreen> {
  final TextEditingController _codeController = TextEditingController();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
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
          'SmartFace',
          style: TextStyle(
            color: AppColors.primaryDarkGreen,
            fontWeight: FontWeight.bold,
            fontSize: 20,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline, color: AppColors.primaryDarkGreen),
            onPressed: () {},
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Tham gia công ty',
              style: TextStyle(
                color: AppColors.textPrimary,
                fontSize: 26,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Nhập mã mời hoặc quét mã QR từ quản trị viên để tham gia tổ chức của bạn.',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontSize: 14,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 24),

            // QR Card
            Container(
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
                  // QR tap row
                  InkWell(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                    onTap: () {},
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 44,
                            decoration: BoxDecoration(
                              color: AppColors.primaryDarkGreen.withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Icon(
                              Icons.qr_code_scanner,
                              color: AppColors.primaryDarkGreen,
                              size: 24,
                            ),
                          ),
                          const SizedBox(width: 14),
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Quét mã QR',
                                  style: TextStyle(
                                    color: AppColors.textPrimary,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                SizedBox(height: 2),
                                Text(
                                  'Mở camera để quét mã từ quản trị viên',
                                  style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 12,
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
                  ),
                  const Divider(height: 1, color: AppColors.divider),

                  // QR Scanner placeholder
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Container(
                      height: 180,
                      decoration: BoxDecoration(
                        color: AppColors.background,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Stack(
                        children: [
                          Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.qr_code_2,
                                  size: 64,
                                  color: AppColors.textSecondary.withValues(alpha: 0.4),
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'Vùng quét QR',
                                  style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 13,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // Corner brackets (golden)
                          Positioned(
                            top: 12,
                            left: 12,
                            child: _CornerBracket(position: _BracketPosition.topLeft),
                          ),
                          Positioned(
                            top: 12,
                            right: 12,
                            child: _CornerBracket(position: _BracketPosition.topRight),
                          ),
                          Positioned(
                            bottom: 12,
                            left: 12,
                            child: _CornerBracket(position: _BracketPosition.bottomLeft),
                          ),
                          Positioned(
                            bottom: 12,
                            right: 12,
                            child: _CornerBracket(position: _BracketPosition.bottomRight),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Divider with text
            Row(
              children: [
                const Expanded(child: Divider(color: AppColors.divider)),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(
                    'HOẶC NHẬP MÃ',
                    style: TextStyle(
                      color: AppColors.textSecondary.withValues(alpha: 0.7),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 1.2,
                    ),
                  ),
                ),
                const Expanded(child: Divider(color: AppColors.divider)),
              ],
            ),
            const SizedBox(height: 20),

            // Text field
            TextField(
              controller: _codeController,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 15,
              ),
              decoration: InputDecoration(
                labelText: 'Mã mời công ty',
                labelStyle: const TextStyle(color: AppColors.textSecondary),
                hintText: 'Ví dụ: SF-12345',
                hintStyle: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.5)),
                prefixIcon: const Icon(
                  Icons.business_center_outlined,
                  color: AppColors.primaryDarkGreen,
                  size: 22,
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Join button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pushNamed(context, '/security_setup');
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.goldButton,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Tham gia công ty',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    SizedBox(width: 8),
                    Text(
                      '→',
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Bottom helper text
            Center(
              child: RichText(
                text: TextSpan(
                  style: const TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 13,
                  ),
                  children: [
                    const TextSpan(text: 'Bạn chưa có mã mời? '),
                    TextSpan(
                      text: 'Liên hệ quản trị viên',
                      style: const TextStyle(
                        color: AppColors.primaryDarkGreen,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 32),

            // Bottom icons
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _InfoBadge(
                  icon: Icons.shield_outlined,
                  label: 'Bảo mật',
                ),
                const SizedBox(width: 32),
                _InfoBadge(
                  icon: Icons.verified_user_outlined,
                  label: 'Xác thực',
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

enum _BracketPosition { topLeft, topRight, bottomLeft, bottomRight }

class _CornerBracket extends StatelessWidget {
  final _BracketPosition position;
  const _CornerBracket({required this.position});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(24, 24),
      painter: _BracketPainter(position: position),
    );
  }
}

class _BracketPainter extends CustomPainter {
  final _BracketPosition position;
  _BracketPainter({required this.position});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.goldButton
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final w = size.width;
    final h = size.height;

    switch (position) {
      case _BracketPosition.topLeft:
        canvas.drawLine(const Offset(0, 14), const Offset(0, 0), paint);
        canvas.drawLine(const Offset(0, 0), const Offset(14, 0), paint);
        break;
      case _BracketPosition.topRight:
        canvas.drawLine(Offset(w - 14, 0), Offset(w, 0), paint);
        canvas.drawLine(Offset(w, 0), Offset(w, 14), paint);
        break;
      case _BracketPosition.bottomLeft:
        canvas.drawLine(Offset(0, h - 14), Offset(0, h), paint);
        canvas.drawLine(Offset(0, h), Offset(14, h), paint);
        break;
      case _BracketPosition.bottomRight:
        canvas.drawLine(Offset(w - 14, h), Offset(w, h), paint);
        canvas.drawLine(Offset(w, h), Offset(w, h - 14), paint);
        break;
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _InfoBadge extends StatelessWidget {
  final IconData icon;
  final String label;
  const _InfoBadge({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppColors.primaryDarkGreen.withValues(alpha: 0.08),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: AppColors.primaryDarkGreen, size: 24),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}
