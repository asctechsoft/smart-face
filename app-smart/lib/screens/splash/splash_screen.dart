import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _dotsController;
  int _dotCount = 1;

  @override
  void initState() {
    super.initState();
    _dotsController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    )..addStatusListener((status) {
        if (status == AnimationStatus.completed) {
          setState(() {
            _dotCount = _dotCount < 3 ? _dotCount + 1 : 1;
          });
          _dotsController.reset();
          _dotsController.forward();
        }
      });
    _dotsController.forward();

    Future.delayed(const Duration(milliseconds: 2500), () {
      if (mounted) {
        Navigator.pushReplacementNamed(context, '/company_setup');
      }
    });
  }

  @override
  void dispose() {
    _dotsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dots = '.' * _dotCount;
    return Scaffold(
      backgroundColor: AppColors.primaryDarkGreen,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Circular avatar with location pin icon
                    Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.primaryLighterGreen,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.3),
                          width: 3,
                        ),
                      ),
                      child: const Icon(
                        Icons.location_on,
                        color: AppColors.orangeAccent,
                        size: 52,
                      ),
                    ),
                    const SizedBox(height: 28),
                    // App name
                    const Text(
                      'SmartFace',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 10),
                    // Subtitle
                    const Text(
                      'Chấm công thông minh bằng GPS & Khuôn mặt',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 14,
                        letterSpacing: 0.3,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 40),
                    // Dots animation
                    Text(
                      dots,
                      style: const TextStyle(
                        color: Colors.white60,
                        fontSize: 24,
                        letterSpacing: 6,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Bottom version info
            Padding(
              padding: const EdgeInsets.only(bottom: 32),
              child: Column(
                children: [
                  const Text(
                    'VERSION v1.0',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 11,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'AMOBI LAB',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 11,
                      letterSpacing: 2,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
