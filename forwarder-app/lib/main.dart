import 'dart:async';
import 'dart:convert';
import 'dart:isolate';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_notification_listener/flutter_notification_listener.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const String kListenerPortName = "_guspay_listener_port_";

// Background isolate callback
@pragma('vm:entry-point')
void _notificationCallback(NotificationEvent evt) {
  // 1. Forward event directly to UI isolate via IsolateNameServer
  try {
    final SendPort? sendPort = IsolateNameServer.lookupPortByName(kListenerPortName);
    sendPort?.send(evt);
  } catch (e) {
    debugPrint('Error sending to UI port: $e');
  }

  // 2. Perform HTTP forward
  _forwardNotificationToBackend(evt);
}

Future<void> _forwardNotificationToBackend(NotificationEvent evt) async {
  try {
    final pkg = (evt.packageName ?? '').toLowerCase();
    final title = evt.title ?? '';
    final text = evt.text ?? evt.message ?? '';

    // Ignore self and core OS system noise
    if (pkg.contains('com.guspay.forwarder') || 
        pkg.contains('android.systemui') || 
        (title.isEmpty && text.isEmpty)) {
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    final serverUrl = prefs.getString('server_url') ?? 'https://gus-pay.rkhyg.xyz';
    final apiKey = prefs.getString('api_key') ?? '';
    final filterApp = (prefs.getString('filter_app') ?? 'id.dana').toLowerCase();

    // Check filter:
    // If id.dana is selected: match 'id.dana' or 'dana' or if text contains 'dana'
    bool isMatch = false;
    if (filterApp == 'id.dana') {
      isMatch = pkg.contains('dana') || 
                title.toLowerCase().contains('dana') || 
                text.toLowerCase().contains('dana');
    } else if (filterApp == 'com.shopee.id') {
      isMatch = pkg.contains('shopee');
    } else if (filterApp == 'all') {
      isMatch = true;
    } else {
      isMatch = pkg.contains(filterApp);
    }

    if (!isMatch) {
      return; // Skip non-targeted app
    }

    if (apiKey.isEmpty) return;

    final endpoint = Uri.parse('$serverUrl/api/v1/webhook/dana');
    final payload = {
      'packageName': evt.packageName ?? 'id.dana',
      'title': title,
      'body': text,
      'timestamp': DateTime.now().toIso8601String(),
    };

    await http.post(
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        'x-forwarder-key': apiKey,
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 8));
  } catch (e) {
    debugPrint('Background forwarding error: $e');
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const GusPayForwarderApp());
}

class GusPayForwarderApp extends StatelessWidget {
  const GusPayForwarderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GusPay Forwarder',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF090D16),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF10B981),
          secondary: Color(0xFF14B8A6),
          surface: Color(0xFF111827),
        ),
        cardColor: const Color(0xFF111827),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFF1A2333),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF1F293D)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF1F293D)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF10B981), width: 2),
          ),
        ),
      ),
      home: const ForwarderHomePage(),
    );
  }
}

class ForwarderHomePage extends StatefulWidget {
  const ForwarderHomePage({super.key});

  @override
  State<ForwarderHomePage> createState() => _ForwarderHomePageState();
}

class _ForwarderHomePageState extends State<ForwarderHomePage> {
  final _serverUrlController = TextEditingController(text: 'https://gus-pay.rkhyg.xyz');
  final _apiKeyController = TextEditingController();
  String _selectedFilter = 'id.dana';
  bool _isServiceRunning = false;
  bool _hasPermission = false;
  final List<Map<String, dynamic>> _logs = [];

  final ReceivePort _receivePort = ReceivePort();

  @override
  void initState() {
    super.initState();
    _initPluginAndPort();
    _loadPreferences();
  }

  @override
  void dispose() {
    IsolateNameServer.removePortNameMapping(kListenerPortName);
    _receivePort.close();
    _serverUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  void _initPluginAndPort() {
    // 1. Register Isolate Port for UI
    IsolateNameServer.removePortNameMapping(kListenerPortName);
    IsolateNameServer.registerPortWithName(_receivePort.sendPort, kListenerPortName);
    _receivePort.listen((dynamic data) {
      if (data is NotificationEvent) {
        final pkg = data.packageName ?? '';
        final title = data.title ?? '';
        final text = data.text ?? data.message ?? '';

        // Filter for UI display
        bool show = true;
        if (_selectedFilter == 'id.dana') {
          show = pkg.toLowerCase().contains('dana') || 
                 title.toLowerCase().contains('dana') || 
                 text.toLowerCase().contains('dana');
        } else if (_selectedFilter == 'com.shopee.id') {
          show = pkg.toLowerCase().contains('shopee');
        }

        if (show) {
          setState(() {
            _logs.insert(0, {
              'time': DateTime.now().toLocal().toString().substring(11, 19),
              'pkg': pkg,
              'title': title,
              'text': text,
            });
            if (_logs.length > 50) _logs.removeLast();
          });
        }
      }
    });

    // 2. Initialize Plugin Dispatcher
    NotificationsListener.initialize(callbackHandle: _notificationCallback);
    _checkPermission();
  }

  Future<void> _loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _serverUrlController.text = prefs.getString('server_url') ?? 'https://gus-pay.rkhyg.xyz';
      _apiKeyController.text = prefs.getString('api_key') ?? '';
      _selectedFilter = prefs.getString('filter_app') ?? 'id.dana';
    });
  }

  Future<void> _savePreferences() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('server_url', _serverUrlController.text.trim());
    await prefs.setString('api_key', _apiKeyController.text.trim());
    await prefs.setString('filter_app', _selectedFilter);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: Color(0xFF047857),
          content: Text('Konfigurasi berhasil disimpan!'),
        ),
      );
    }
  }

  Future<void> _checkPermission() async {
    final hasPermission = await NotificationsListener.hasPermission ?? false;
    final isRunning = await NotificationsListener.isRunning ?? false;
    setState(() {
      _hasPermission = hasPermission;
      _isServiceRunning = isRunning;
    });
  }

  Future<void> _requestPermission() async {
    await NotificationsListener.openPermissionSettings();
    Future.delayed(const Duration(seconds: 2), _checkPermission);
  }

  Future<void> _toggleService() async {
    if (!_hasPermission) {
      await _requestPermission();
      return;
    }

    if (_isServiceRunning) {
      await NotificationsListener.stopService();
      setState(() => _isServiceRunning = false);
    } else {
      await _savePreferences();
      // Ensure initialized before start
      await NotificationsListener.initialize(callbackHandle: _notificationCallback);
      final started = await NotificationsListener.startService(
        title: "GusPay Forwarder Aktif",
        description: "Standby memantau notifikasi pembayaran DANA Bisnis...",
      );
      setState(() => _isServiceRunning = started ?? false);
    }
  }

  Future<void> _testPing() async {
    final url = _serverUrlController.text.trim();
    final key = _apiKeyController.text.trim();
    if (url.isEmpty || key.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Masukkan Server URL dan Forwarder Key dahulu!')),
      );
      return;
    }

    try {
      final res = await http.get(
        Uri.parse('$url/api/v1/forwarder/ping?key=$key'),
      ).timeout(const Duration(seconds: 8));

      final json = jsonDecode(res.body);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: res.statusCode == 200 ? const Color(0xFF047857) : Colors.red,
            content: Text(res.statusCode == 200 ? '✓ Terhubung: ${json['message']}' : '✗ Gagal: ${res.body}'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: Colors.red, content: Text('Error: $e')),
        );
      }
    }
  }

  Future<void> _testForwardSample() async {
    final url = _serverUrlController.text.trim();
    final key = _apiKeyController.text.trim();
    if (url.isEmpty || key.isEmpty) return;

    try {
      final payload = {
        'packageName': 'id.dana',
        'title': 'Pembayaran Berhasil! (Test)',
        'body': 'Kamu menerima Rp 10.001 dari 08123456789 via QRIS',
        'timestamp': DateTime.now().toIso8601String(),
      };

      final res = await http.post(
        Uri.parse('$url/api/v1/webhook/dana'),
        headers: {
          'Content-Type': 'application/json',
          'x-forwarder-key': key,
        },
        body: jsonEncode(payload),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: const Color(0xFF047857),
            content: Text('Hasil Test: ${res.body}'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(backgroundColor: Colors.red, content: Text('Error: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.qr_code_2, color: Color(0xFF10B981)),
            SizedBox(width: 8),
            Text('GusPay Forwarder', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
          ],
        ),
        backgroundColor: const Color(0xFF111827),
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _checkPermission,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Status Card
            Card(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Status Layanan Forwarder', style: TextStyle(fontSize: 12, color: Colors.grey)),
                            const SizedBox(height: 4),
                            Text(
                              _isServiceRunning ? 'AKTIF (MEMANTAU DANA)' : 'BERHENTI (STANDBY)',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: _isServiceRunning ? const Color(0xFF10B981) : Colors.amber,
                              ),
                            ),
                          ],
                        ),
                        Switch(
                          value: _isServiceRunning,
                          activeThumbColor: const Color(0xFF10B981),
                          onChanged: (val) => _toggleService(),
                        ),
                      ],
                    ),
                    if (!_hasPermission) ...[
                      const Divider(height: 24, color: Color(0xFF1F293D)),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.amber[800],
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        onPressed: _requestPermission,
                        icon: const Icon(Icons.security, size: 18),
                        label: const Text('Aktifkan Izin Akses Notifikasi'),
                      ),
                    ]
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Server Config Card
            Card(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Konfigurasi Gateway', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _serverUrlController,
                      decoration: const InputDecoration(
                        labelText: 'Server URL',
                        prefixIcon: Icon(Icons.cloud_outlined, color: Color(0xFF10B981)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _apiKeyController,
                      decoration: const InputDecoration(
                        labelText: 'Forwarder Key',
                        prefixIcon: Icon(Icons.key, color: Color(0xFF10B981)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: _selectedFilter,
                      decoration: const InputDecoration(
                        labelText: 'Filter Aplikasi Target',
                        prefixIcon: Icon(Icons.filter_list, color: Color(0xFF10B981)),
                      ),
                      dropdownColor: const Color(0xFF1A2333),
                      items: const [
                        DropdownMenuItem(value: 'id.dana', child: Text('Hanya DANA (id.dana) - Rekomendasi')),
                        DropdownMenuItem(value: 'com.shopee.id', child: Text('Hanya Shopee (com.shopee.id)')),
                        DropdownMenuItem(value: 'all', child: Text('Semua Notifikasi (All)')),
                      ],
                      onChanged: (val) => setState(() => _selectedFilter = val ?? 'id.dana'),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF10B981),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            onPressed: _savePreferences,
                            icon: const Icon(Icons.save, size: 16),
                            label: const Text('Simpan'),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: Color(0xFF1F293D)),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                            ),
                            onPressed: _testPing,
                            icon: const Icon(Icons.bolt, size: 16, color: Color(0xFF10B981)),
                            label: const Text('Test Ping'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: TextButton.icon(
                        onPressed: _testForwardSample,
                        icon: const Icon(Icons.send_outlined, size: 16, color: Colors.grey),
                        label: const Text('Kirim Test Dummy Notif ke Server', style: TextStyle(color: Colors.grey, fontSize: 12)),
                      ),
                    )
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Live Notification Logs
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Log Notifikasi DANA Masuk', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                if (_logs.isNotEmpty)
                  TextButton(
                    onPressed: () => setState(() => _logs.clear()),
                    child: const Text('Bersihkan', style: TextStyle(fontSize: 12, color: Colors.grey)),
                  )
              ],
            ),
            const SizedBox(height: 8),
            if (_logs.isEmpty)
              Container(
                padding: const EdgeInsets.all(32),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFF111827),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFF1F293D)),
                ),
                child: const Text('Belum ada notifikasi DANA yang masuk.', style: TextStyle(color: Colors.grey, fontSize: 12)),
              )
            else
              ListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _logs.length,
                itemBuilder: (context, index) {
                  final log = _logs[index];
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF111827),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFF1F293D)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(log['pkg'], style: const TextStyle(fontSize: 11, color: Color(0xFF10B981), fontWeight: FontWeight.bold)),
                            Text(log['time'], style: const TextStyle(fontSize: 10, color: Colors.grey)),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(log['title'], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
                        const SizedBox(height: 2),
                        Text(log['text'], style: const TextStyle(fontSize: 12, color: Colors.grey)),
                      ],
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}
