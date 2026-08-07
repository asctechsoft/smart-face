import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'screens/splash/splash_screen.dart';
import 'screens/onboarding/company_setup_screen.dart';
import 'screens/onboarding/security_setup_screen.dart';
import 'screens/main/main_screen.dart';

void main() => runApp(const AppSmartApp());

class AppSmartApp extends StatelessWidget {
  const AppSmartApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SmartFace',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      initialRoute: '/splash',
      routes: {
        '/splash': (context) => const SplashScreen(),
        '/company_setup': (context) => const CompanySetupScreen(),
        '/security_setup': (context) => const SecuritySetupScreen(),
        '/main': (context) => const MainScreen(),
      },
    );
  }
}
