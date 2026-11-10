import 'dart:async';

import 'package:flutter/material.dart';

import '../api/api.dart';
import '../core/app_connections.dart';
import '../core/core.dart';
import '../core/schedules.dart';
import '../core/usage.dart';
import '../design_system/design_system.dart';
import '../features/apps/apps_page.dart';
import '../features/chat/chat.dart';
import '../features/scheduled/scheduled_page.dart';
import '../features/usage/usage_page.dart';
import '../motion/motion.dart';

class NodClientApp extends StatefulWidget {
  const NodClientApp({
    super.key,
    this.repository,
    this.restoreConnection,
    this.disposeRepository = true,
    this.themeMode = ThemeMode.system,
  });

  final NodRepository? repository;
  final Future<bool> Function()? restoreConnection;
  final bool disposeRepository;
  final ThemeMode themeMode;

  @override
  State<NodClientApp> createState() => _NodClientAppState();
}

class _NodClientAppState extends State<NodClientApp> {
  late final NodRepository _repository;
  var _restoring = true;
  var _connected = false;
  var _selectedIndex = 0;
  String? _connectionError;

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? HttpNodRepository();
    unawaited(_restore());
  }

  Future<void> _restore() async {
    try {
      final restored = widget.restoreConnection != null
          ? await widget.restoreConnection!()
          : _repository is HttpNodRepository
          ? await _repository.connectStored()
          : false;
      if (!mounted) return;
      setState(() {
        _connected = restored;
        _restoring = false;
      });
    } on NodException catch (error) {
      if (!mounted) return;
      setState(() {
        _connectionError = error.message;
        _restoring = false;
      });
    }
  }

  Future<void> _connect(NodConnectionConfig config) async {
    setState(() => _connectionError = null);
    try {
      await _repository.connect(config);
      if (!mounted) return;
      setState(() {
        _connected = true;
        _selectedIndex = 0;
      });
    } on NodException catch (error) {
      if (!mounted) return;
      setState(() => _connectionError = error.message);
      rethrow;
    }
  }

  Future<void> _logOut() async {
    if (_repository case final HttpNodRepository repository) {
      await repository.forgetCredentials();
    }
    await _repository.disconnect();
    if (!mounted) return;
    setState(() {
      _connected = false;
      _connectionError = null;
    });
  }

  @override
  void dispose() {
    if (widget.disposeRepository && _repository is HttpNodRepository) {
      unawaited(_repository.dispose());
    } else if (widget.disposeRepository) {
      unawaited(_repository.disconnect());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Nod',
      debugShowCheckedModeBanner: false,
      theme: NodTheme.light,
      darkTheme: NodTheme.dark,
      themeMode: widget.themeMode,
      home: NodMotionLifecycle(
        child: _restoring
            ? const _RestoringConnection()
            : _connected
            ? _ConnectedShell(
                repository: _repository,
                selectedIndex: _selectedIndex,
                onDestinationSelected: (index) {
                  setState(() => _selectedIndex = index);
                },
                onLogOut: _logOut,
              )
            : _ConnectionPage(error: _connectionError, onConnect: _connect),
      ),
    );
  }
}

class _RestoringConnection extends StatelessWidget {
  const _RestoringConnection();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const NodPresence(state: NodMotionState.connecting, size: 72),
            const SizedBox(height: NodSpacing.lg),
            Text(
              'Reconnecting to Nod',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ],
        ),
      ),
    );
  }
}

class _ConnectionPage extends StatefulWidget {
  const _ConnectionPage({required this.error, required this.onConnect});

  final String? error;
  final Future<void> Function(NodConnectionConfig config) onConnect;

  @override
  State<_ConnectionPage> createState() => _ConnectionPageState();
}

class _ConnectionPageState extends State<_ConnectionPage> {
  final _formKey = GlobalKey<FormState>();
  final _originController = TextEditingController();
  final _tokenController = TextEditingController();
  var _submitting = false;
  var _hideToken = true;

  @override
  void dispose() {
    _originController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting || !_formKey.currentState!.validate()) return;
    NodConnectionConfig config;
    try {
      config = NodConnectionConfig(
        origin: validateNodOrigin(Uri.parse(_originController.text.trim())),
        token: _tokenController.text,
      );
    } on NodException {
      _formKey.currentState!.validate();
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.onConnect(config);
      _tokenController.clear();
    } on NodException {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.nodColors;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(NodSpacing.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: NodBrandMark(size: 56),
                    ),
                    const SizedBox(height: NodSpacing.lg),
                    Text(
                      'Connect this app to Nod',
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: NodSpacing.sm),
                    Text(
                      'Enter the connection details provided by your Nod server. They stay on this device in secure storage.',
                      style: Theme.of(context).textTheme.bodyLarge
                          ?.copyWith(color: colors.textSecondary),
                    ),
                    const SizedBox(height: NodSpacing.xl),
                    TextFormField(
                      key: const Key('connection-origin'),
                      controller: _originController,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Nod server address',
                        hintText: 'https://nod.example.com',
                        helperText: 'Use the full HTTPS address.',
                      ),
                      validator: (value) {
                        try {
                          validateNodOrigin(Uri.parse(value?.trim() ?? ''));
                          return null;
                        } on NodException catch (error) {
                          return error.message;
                        }
                      },
                    ),
                    const SizedBox(height: NodSpacing.md),
                    TextFormField(
                      key: const Key('connection-token'),
                      controller: _tokenController,
                      obscureText: _hideToken,
                      enableSuggestions: false,
                      autocorrect: false,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Access token',
                        helperText: 'Stored securely and never shown again.',
                        suffixIcon: IconButton(
                          tooltip: _hideToken ? 'Show token' : 'Hide token',
                          onPressed: () =>
                              setState(() => _hideToken = !_hideToken),
                          icon: Icon(
                            _hideToken
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                      ),
                      validator: (value) => value == null || value.isEmpty
                          ? 'Enter the server token.'
                          : null,
                    ),
                    if (widget.error != null) ...[
                      const SizedBox(height: NodSpacing.md),
                      Semantics(
                        container: true,
                        liveRegion: true,
                        label: 'Connection error: ${widget.error!}',
                        excludeSemantics: true,
                        child: Container(
                          key: const Key('connection-error'),
                          padding: const EdgeInsets.all(NodSpacing.md),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.errorContainer,
                            borderRadius: BorderRadius.circular(NodRadii.input),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.error_outline_rounded,
                                color: Theme.of(context)
                                    .colorScheme
                                    .onErrorContainer,
                              ),
                              const SizedBox(width: NodSpacing.sm),
                              Expanded(
                                child: Text(
                                  widget.error!,
                                  style: Theme.of(context).textTheme.bodyMedium
                                      ?.copyWith(
                                        color: Theme.of(context)
                                            .colorScheme
                                            .onErrorContainer,
                                      ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: NodSpacing.lg),
                    FilledButton.icon(
                      key: const Key('connection-submit'),
                      onPressed: _submitting ? null : _submit,
                      icon: _submitting
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.link_rounded),
                      label: Text(
                        _submitting ? 'Connecting to Nod' : 'Connect to Nod',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ConnectedShell extends StatelessWidget {
  const _ConnectedShell({
    required this.repository,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.onLogOut,
  });

  final NodRepository repository;
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final Future<void> Function() onLogOut;

  @override
  Widget build(BuildContext context) {
    return NodAdaptiveShell(
      selectedIndex: selectedIndex,
      onDestinationSelected: (index) {
        FocusManager.instance.primaryFocus?.unfocus();
        onDestinationSelected(index);
      },
      onLogOut: onLogOut,
      body: IndexedStack(
        index: selectedIndex == 0 ? 0 : 1,
        children: [
          NodChat(repository: repository, active: selectedIndex == 0),
          selectedIndex == 1 && repository is NodSchedulesRepository
              ? NodScheduledPage(
                  repository: repository as NodSchedulesRepository,
                  onOpenChat: () => onDestinationSelected(0),
                )
              : selectedIndex == 3 && repository is NodUsageRepository
              ? NodUsagePage(repository: repository as NodUsageRepository)
              : selectedIndex == 2 && repository is NodAppsRepository
              ? NodAppsPage(repository: repository as NodAppsRepository)
              : _SectionPlaceholder(
                  destination: NodNavigationModel.destinations[selectedIndex],
                ),
        ],
      ),
    );
  }
}

class _SectionPlaceholder extends StatelessWidget {
  const _SectionPlaceholder({required this.destination});

  final NodNavigationDestination destination;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.nodColors.canvas,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(NodSpacing.lg),
          child: Text(
            '${destination.label} remains outside this client POC.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ),
      ),
    );
  }
}
