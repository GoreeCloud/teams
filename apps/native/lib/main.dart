import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

void main() => runApp(const GoreeCloudTeamsApp());

class TeamsApi {
  TeamsApi(this.baseUrl, [this.accessToken]);
  final String baseUrl;
  String? accessToken;

  Future<dynamic> request(String route,
      {String method = 'GET', Map<String, dynamic>? data}) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 12);
    try {
      final request =
          await client.openUrl(method, Uri.parse('$baseUrl/api$route'));
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (accessToken != null) {
        request.headers
            .set(HttpHeaders.authorizationHeader, 'Bearer $accessToken');
      }
      if (data != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(data));
      }
      final response =
          await request.close().timeout(const Duration(seconds: 18));
      final decoded = jsonDecode(await utf8.decoder.bind(response).join());
      if (response.statusCode >= 400) {
        throw Exception(decoded is Map
            ? (decoded['error'] ?? 'Request failed')
            : 'Request failed');
      }
      return decoded;
    } on SocketException {
      throw Exception(
          'Cannot reach your Teams server. Check the address and network.');
    } finally {
      client.close(force: true);
    }
  }

  Future<WebSocket> connectEvents() async {
    final uri = Uri.parse(baseUrl);
    return WebSocket.connect(
      uri
          .replace(
              scheme: uri.scheme == 'https' ? 'wss' : 'ws', path: '/api/events')
          .toString(),
      headers: {HttpHeaders.authorizationHeader: 'Bearer $accessToken'},
    );
  }
}

class GcColors {
  static const darkCanvas = Color(0xFF0D121D);
  static const darkSurface = Color(0xFF171D2A);
  static const darkTonal = Color(0xFF252D3D);
  static const darkBrand = Color(0xFFBFB8FF);
  static const lightBrand = Color(0xFF5146C8);
  static ThemeData theme(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final scheme = dark
        ? const ColorScheme.dark(
            primary: darkBrand,
            onPrimary: Color(0xFF272057),
            surface: darkSurface,
            onSurface: Color(0xFFF2F4FB),
            secondaryContainer: Color(0xFF413974),
            onSecondaryContainer: Color(0xFFE8E5FF),
            outline: Color(0xFF9CA8BC),
            error: Color(0xFFFFB4AB))
        : const ColorScheme.light(
            primary: lightBrand,
            onPrimary: Colors.white,
            surface: Colors.white,
            onSurface: Color(0xFF1B2030),
            secondaryContainer: Color(0xFFE8E5FF),
            onSecondaryContainer: Color(0xFF30266F),
            outline: Color(0xFF68758C),
            error: Color(0xFFB3261E));
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: dark ? darkCanvas : const Color(0xFFF6F7FB),
      cardTheme: CardThemeData(color: scheme.surface, elevation: 0),
      inputDecorationTheme: InputDecorationTheme(
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 16)),
      filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
              minimumSize: const Size(44, 48),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)))),
      appBarTheme: AppBarTheme(
          backgroundColor: scheme.surface, scrolledUnderElevation: 0),
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }
}

class GoreeCloudTeamsApp extends StatelessWidget {
  const GoreeCloudTeamsApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'GoreeCloud Teams',
        debugShowCheckedModeBanner: false,
        theme: GcColors.theme(Brightness.light),
        darkTheme: GcColors.theme(Brightness.dark),
        themeMode: ThemeMode.system,
        home: const TeamsHome(),
      );
}

class TeamsHome extends StatefulWidget {
  const TeamsHome({super.key});
  @override
  State<TeamsHome> createState() => _TeamsHomeState();
}

class _TeamsHomeState extends State<TeamsHome> {
  TeamsApi? api;
  final serverController = TextEditingController(text: 'https://');
  final usernameController = TextEditingController();
  final passwordController = TextEditingController();
  final nameController = TextEditingController();
  final inviteController = TextEditingController();
  final composerController = TextEditingController();
  bool connected = false, bootstrap = false, register = false, busy = false;
  String? currentUserId;
  String? workspaceId, workspaceName, channelId, channelName, threadId;
  String? threadTitle;
  List<Map<String, dynamic>> workspaces = [], channels = [], messages = [];
  WebSocket? socket;
  Timer? reconnectTimer;
  int socketGeneration = 0;

  @override
  void dispose() {
    reconnectTimer?.cancel();
    socketGeneration++;
    socket?.close();
    serverController.dispose();
    usernameController.dispose();
    passwordController.dispose();
    nameController.dispose();
    inviteController.dispose();
    composerController.dispose();
    super.dispose();
  }

  Future<void> guarded(Future<void> Function() work) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await work();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  String parseServer(String input) {
    final parsed = Uri.tryParse(input.trim());
    if (parsed == null ||
        !parsed.hasAuthority ||
        (parsed.scheme != 'https' && parsed.scheme != 'http') ||
        parsed.userInfo.isNotEmpty ||
        parsed.query.isNotEmpty ||
        parsed.fragment.isNotEmpty ||
        (parsed.path.isNotEmpty && parsed.path != '/')) {
      throw Exception(
          'Enter a complete server URL such as https://your-server.example');
    }
    const local = {'localhost', '127.0.0.1', '::1'};
    if (parsed.scheme != 'https' && !local.contains(parsed.host)) {
      throw Exception('HTTPS is required outside localhost.');
    }
    return parsed.origin;
  }

  Future<void> connect() => guarded(() async {
        final url = parseServer(serverController.text);
        final candidate = TeamsApi(url);
        final config = await candidate.request('/config') as Map;
        if (!mounted) return;
        setState(() {
          api = candidate;
          bootstrap = config['bootstrapAvailable'] == true;
          register = bootstrap;
          connected = true;
        });
      });

  Future<void> authenticate() => guarded(() async {
        final credentials = register
            ? {
                'username': usernameController.text.trim(),
                'displayName': nameController.text.trim(),
                'password': passwordController.text,
                'invite': inviteController.text.trim()
              }
            : {
                'username': usernameController.text.trim(),
                'password': passwordController.text
              };
        final result = await api!.request(
            register ? '/auth/register' : '/auth/login',
            method: 'POST',
            data: credentials) as Map;
        api!.accessToken = result['accessToken'] as String;
        currentUserId = (result['user'] as Map)['id'] as String;
        passwordController.clear();
        if (!mounted) return;
        await loadWorkspaces();
        listenRealtime();
      });

  Future<void> loadWorkspaces() async {
    final result = await api!.request('/workspaces') as List;
    if (!mounted) return;
    setState(() {
      workspaces = result.cast<Map<String, dynamic>>();
      workspaceId =
          workspaces.isNotEmpty ? workspaces.first['id'] as String : null;
      workspaceName =
          workspaces.isNotEmpty ? workspaces.first['name'] as String : null;
    });
    await loadChannels();
  }

  Future<void> loadChannels() async {
    if (workspaceId == null) return;
    final result =
        await api!.request('/workspaces/$workspaceId/channels') as List;
    if (!mounted) return;
    setState(() {
      channels = result.cast<Map<String, dynamic>>();
      final selected = channels.where((ch) => ch['id'] == channelId).toList();
      final next = selected.isNotEmpty
          ? selected.first
          : (channels.isNotEmpty ? channels.first : null);
      channelId = next?['id'] as String?;
      channelName = next?['name'] as String?;
      threadId = null;
    });
    await loadMessages();
  }

  Future<void> loadMessages() async {
    if (channelId == null) return;
    final route =
        '/channels/$channelId/messages${threadId != null ? '?parentId=$threadId' : ''}';
    final result = await api!.request(route) as List;
    if (mounted) setState(() => messages = result.cast<Map<String, dynamic>>());
  }

  void listenRealtime() {
    final generation = ++socketGeneration;
    reconnectTimer?.cancel();
    () async {
      try {
        final live = await api!.connectEvents();
        if (!mounted || generation != socketGeneration) {
          await live.close();
          return;
        }
        socket = live;
        live.listen((data) {
          try {
            final event = jsonDecode(data as String) as Map;
            if (event['channelId'] == channelId && event['message'] != null) {
              final message = event['message'] as Map;
              if ((threadId == null && message['parentId'] == null) ||
                  (threadId != null && message['parentId'] == threadId)) {
                loadMessages();
              }
            }
          } catch (_) {/* Ignore malformed optional event */}
        },
            onDone: () => scheduleReconnect(generation),
            onError: (_) => scheduleReconnect(generation));
      } catch (_) {
        scheduleReconnect(generation);
      }
    }();
  }

  void scheduleReconnect(int generation) {
    if (!mounted ||
        generation != socketGeneration ||
        api?.accessToken == null) {
      return;
    }
    reconnectTimer?.cancel();
    reconnectTimer = Timer(const Duration(seconds: 4), listenRealtime);
  }

  Future<void> sendMessage() => guarded(() async {
        if (channelId == null || composerController.text.trim().isEmpty) return;
        await api!
            .request('/channels/$channelId/messages', method: 'POST', data: {
          'body': composerController.text.trim(),
          if (threadId != null) 'parentId': threadId
        });
        composerController.clear();
        await loadMessages();
      });

  void chooseChannel(Map<String, dynamic> channel) {
    setState(() {
      channelId = channel['id'] as String;
      channelName = channel['name'] as String;
      threadId = null;
      threadTitle = null;
      messages = [];
    });
    loadMessages();
    Navigator.of(context).maybePop();
  }

  void openThread(Map<String, dynamic> message) {
    setState(() {
      threadId = message['id'] as String;
      threadTitle = (message['body'] as String?) ?? 'Thread';
      messages = [];
    });
    loadMessages();
  }

  void closeThread() {
    setState(() {
      threadId = null;
      threadTitle = null;
      messages = [];
    });
    loadMessages();
  }

  Future<void> reactTo(Map<String, dynamic> message) => guarded(() async {
        await api!.request('/messages/${message['id']}/reactions',
            method: 'POST', data: {'emoji': '👍'});
        await loadMessages();
      });

  Future<void> editMessage(Map<String, dynamic> message) async {
    final editor =
        TextEditingController(text: (message['body'] as String?) ?? '');
    final edited = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
                title: const Text('Edit message'),
                content: TextField(
                    controller: editor,
                    maxLength: 4000,
                    minLines: 2,
                    maxLines: 6),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, editor.text),
                      child: const Text('Save'))
                ]));
    editor.dispose();
    if (edited == null || edited.trim().isEmpty) return;
    await guarded(() async {
      await api!.request('/messages/${message['id']}',
          method: 'PATCH', data: {'body': edited.trim()});
      await loadMessages();
    });
  }

  Future<void> deleteMessage(Map<String, dynamic> message) async {
    final confirm = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
                title: const Text('Delete this message?'),
                content: const Text(
                    'The message content will be removed from the channel.'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Delete'))
                ]));
    if (confirm != true) return;
    await guarded(() async {
      await api!.request('/messages/${message['id']}', method: 'DELETE');
      await loadMessages();
    });
  }

  Future<void> addChannel() async {
    final controller = TextEditingController();
    bool private = false;
    final details = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
            builder: (context, setLocal) => AlertDialog(
                    title: const Text('New channel'),
                    content: Column(mainAxisSize: MainAxisSize.min, children: [
                      TextField(
                          controller: controller,
                          decoration:
                              const InputDecoration(labelText: 'Channel name')),
                      const SizedBox(height: 12),
                      CheckboxListTile(
                          title: const Text('Private channel'),
                          value: private,
                          onChanged: (value) =>
                              setLocal(() => private = value ?? false)),
                    ]),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(dialogContext),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(dialogContext, {
                                'name': controller.text.trim(),
                                'isPrivate': private
                              }),
                          child: const Text('Create'))
                    ])));
    controller.dispose();
    if (details == null) return;
    await guarded(() async {
      await api!.request('/workspaces/$workspaceId/channels',
          method: 'POST', data: details);
      await loadChannels();
    });
  }

  Future<void> createInvite() => guarded(() async {
        final response = await api!.request('/workspaces/$workspaceId/invites',
            method: 'POST', data: {'role': 'member'}) as Map;
        if (!mounted) return;
        await showDialog<void>(
            context: context,
            builder: (context) => AlertDialog(
                    title: const Text('Invitation code'),
                    content: SelectableText(response['invite'] as String),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context),
                          child: const Text('Done'))
                    ]));
      });

  void signOut() {
    api?.request('/auth/logout', method: 'POST').catchError((_) => null);
    socketGeneration++;
    reconnectTimer?.cancel();
    socket?.close();
    setState(() {
      api?.accessToken = null;
      currentUserId = null;
      connected = false;
      workspaces = [];
      channels = [];
      messages = [];
      workspaceId = null;
      channelId = null;
      threadId = null;
    });
  }

  Future<void> searchMessages() async {
    final controller = TextEditingController();
    final query = await showDialog<String>(
        context: context,
        builder: (context) => AlertDialog(
                title: const Text('Search conversations'),
                content: TextField(
                    controller: controller,
                    autofocus: true,
                    decoration:
                        const InputDecoration(hintText: 'Search messages')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, controller.text),
                      child: const Text('Search'))
                ]));
    controller.dispose();
    if (query == null || query.trim().length < 2) return;
    await guarded(() async {
      final result = await api!.request(
              '/workspaces/$workspaceId/search?q=${Uri.encodeQueryComponent(query.trim())}')
          as List;
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
                  title: const Text('Search results'),
                  content: SizedBox(
                      width: 500,
                      height: 380,
                      child: result.isEmpty
                          ? const Center(child: Text('No matches found'))
                          : ListView(
                              children: result
                                  .cast<Map>()
                                  .map((m) => ListTile(
                                        title: Text(m['author'] as String? ??
                                            'Team member'),
                                        subtitle:
                                            Text(m['body'] as String? ?? ''),
                                        onTap: () {
                                          Navigator.pop(context);
                                          final match = channels
                                              .where((c) =>
                                                  c['id'] == m['channelId'])
                                              .toList();
                                          if (match.isNotEmpty) {
                                            chooseChannel(match.first);
                                          }
                                        },
                                      ))
                                  .toList())),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(context),
                        child: const Text('Close'))
                  ]));
    });
  }

  Widget serverPage() => Center(
          child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 430),
        child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(Icons.hub_outlined,
                    size: 58, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 28),
                Text('Your team. Your space.',
                    style: Theme.of(context).textTheme.headlineMedium,
                    textAlign: TextAlign.center),
                const SizedBox(height: 12),
                const Text(
                    'Connect to your self-hosted GoreeCloud Teams server.',
                    textAlign: TextAlign.center),
                const SizedBox(height: 32),
                TextField(
                    controller: serverController,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                        labelText: 'Server URL',
                        hintText: 'https://teams.example.org')),
                const SizedBox(height: 16),
                FilledButton.icon(
                    onPressed: busy ? null : connect,
                    icon: const Icon(Icons.arrow_forward),
                    label: const Text('Connect')),
                const SizedBox(height: 16),
                const Text(
                    'HTTPS is required for remote servers. No credentials are saved on this device.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12)),
              ],
            )),
      ));

  Widget loginPage() => Center(
          child: SingleChildScrollView(
              child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 430),
        child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Icon(Icons.forum_outlined,
                    size: 56, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 24),
                Text(
                    register
                        ? (bootstrap ? 'Create your team.' : 'Join your team.')
                        : 'Welcome back.',
                    style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 8),
                const Text('Collaborate privately, wherever you work.'),
                const SizedBox(height: 26),
                TextField(
                    controller: usernameController,
                    decoration: const InputDecoration(labelText: 'Username')),
                if (register) ...[
                  const SizedBox(height: 14),
                  TextField(
                      controller: nameController,
                      decoration:
                          const InputDecoration(labelText: 'Display name')),
                ],
                const SizedBox(height: 14),
                TextField(
                    controller: passwordController,
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Password')),
                if (register && !bootstrap) ...[
                  const SizedBox(height: 14),
                  TextField(
                      controller: inviteController,
                      decoration:
                          const InputDecoration(labelText: 'Invitation code')),
                ],
                const SizedBox(height: 22),
                FilledButton(
                    onPressed: busy ? null : authenticate,
                    child: Text(register ? 'Create account' : 'Sign in')),
                if (!bootstrap)
                  TextButton(
                      onPressed: () => setState(() => register = !register),
                      child: Text(register
                          ? 'Already registered? Sign in'
                          : 'Have an invite? Register')),
                TextButton(
                    onPressed: () => setState(() => connected = false),
                    child: const Text('Change server')),
              ],
            )),
      )));

  Widget channelSidebar({bool drawer = false}) => Container(
        width: 276,
        color: Theme.of(context).colorScheme.surface,
        child: Column(children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 18),
              child: Row(children: [
                CircleAvatar(
                    backgroundColor: Theme.of(context).colorScheme.primary,
                    child: Text('G',
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.onPrimary))),
                const SizedBox(width: 12),
                Expanded(
                    child: Text(workspaceName ?? 'Teams',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleMedium)),
              ])),
          const Divider(height: 1),
          Padding(
              padding: const EdgeInsets.fromLTRB(20, 24, 12, 12),
              child: Row(children: [
                const Expanded(
                    child: Text('CHANNELS',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 12))),
                IconButton(
                    tooltip: 'New channel',
                    onPressed: addChannel,
                    icon: const Icon(Icons.add)),
              ])),
          Expanded(
              child: ListView.builder(
                  itemCount: channels.length,
                  itemBuilder: (context, index) {
                    final ch = channels[index];
                    return Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        child: ListTile(
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                          selected: ch['id'] == channelId,
                          selectedTileColor:
                              Theme.of(context).colorScheme.secondaryContainer,
                          leading: Icon(
                              ch['isPrivate'] == 1
                                  ? Icons.lock_outline
                                  : Icons.tag,
                              size: 20),
                          title: Text(ch['name'] as String),
                          onTap: () => chooseChannel(ch),
                        ));
                  })),
          const Divider(height: 1),
          ListTile(
              leading: const Icon(Icons.person_add_alt),
              title: const Text('Invite a teammate'),
              onTap: createInvite),
          ListTile(
              leading: const Icon(Icons.logout),
              title: const Text('Sign out'),
              onTap: signOut),
          const SizedBox(height: 12),
        ]),
      );

  Widget messageTile(Map<String, dynamic> msg) {
    final author = msg['author'] as String? ?? 'Unknown';
    final deleted = msg['deletedAt'] != null;
    final mine = msg['authorId'] == currentUserId;
    final timestamp =
        DateTime.tryParse(msg['createdAt'] as String? ?? '')?.toLocal();
    final time = timestamp == null
        ? ''
        : TimeOfDay.fromDateTime(timestamp).format(context);
    final reactions = (msg['reactions'] as List? ?? []);
    return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Card(
            child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CircleAvatar(
                        radius: 18,
                        child: Text(
                            author.isNotEmpty ? author[0].toUpperCase() : '?')),
                    const SizedBox(width: 12),
                    Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                          Row(children: [
                            Expanded(
                                child: Text(author,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.bold))),
                            Text(time,
                                style: Theme.of(context).textTheme.labelSmall),
                            PopupMenuButton<String>(
                              tooltip: 'Message actions',
                              icon: const Icon(Icons.more_vert, size: 18),
                              onSelected: (action) {
                                if (action == 'reply') openThread(msg);
                                if (action == 'react') reactTo(msg);
                                if (action == 'edit') editMessage(msg);
                                if (action == 'delete') deleteMessage(msg);
                              },
                              itemBuilder: (context) => [
                                if (threadId == null)
                                  const PopupMenuItem(
                                      value: 'reply',
                                      child: Text('Reply in thread')),
                                if (!deleted)
                                  const PopupMenuItem(
                                      value: 'react', child: Text('React 👍')),
                                if (mine && !deleted)
                                  const PopupMenuItem(
                                      value: 'edit', child: Text('Edit')),
                                if (mine && !deleted)
                                  const PopupMenuItem(
                                      value: 'delete', child: Text('Delete')),
                              ],
                            ),
                          ]),
                          Text(
                              deleted
                                  ? 'Message deleted'
                                  : msg['body'] as String? ?? '',
                              style: deleted
                                  ? const TextStyle(fontStyle: FontStyle.italic)
                                  : null),
                          if (reactions.isNotEmpty)
                            Wrap(
                                spacing: 6,
                                children: reactions
                                    .map((r) => ActionChip(
                                        label:
                                            Text('${r['emoji']} ${r['count']}'),
                                        onPressed: () => reactTo(msg)))
                                    .toList()),
                        ])),
                  ],
                ))));
  }

  Widget chatPanel() => Column(children: [
        if (threadId != null)
          ListTile(
              leading: IconButton(
                  onPressed: closeThread,
                  icon: const Icon(Icons.arrow_back),
                  tooltip: 'Back to channel'),
              title: const Text('Thread'),
              subtitle: Text(threadTitle ?? '',
                  maxLines: 1, overflow: TextOverflow.ellipsis)),
        Expanded(
            child: messages.isEmpty
                ? Center(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.forum_outlined,
                        size: 52, color: Theme.of(context).colorScheme.primary),
                    const SizedBox(height: 16),
                    Text('Start the conversation',
                        style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 6),
                    const Text('Your team messages will appear here.'),
                  ]))
                : ListView.builder(
                    reverse: true,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    itemCount: messages.length,
                    itemBuilder: (context, index) =>
                        messageTile(messages[messages.length - 1 - index]))),
        Padding(
            padding: const EdgeInsets.all(14),
            child: Row(children: [
              Expanded(
                  child: TextField(
                      controller: composerController,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 4000,
                      buildCounter: (context,
                              {required currentLength,
                              required isFocused,
                              maxLength}) =>
                          null,
                      decoration: InputDecoration(
                          labelText: threadId == null
                              ? 'Message #$channelName'
                              : 'Reply in thread',
                          filled: true,
                          fillColor: Theme.of(context).colorScheme.surface))),
              const SizedBox(width: 10),
              IconButton.filled(
                  onPressed: busy ? null : sendMessage,
                  tooltip: 'Send message',
                  icon: const Icon(Icons.send)),
            ])),
      ]);

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 800;
    return Scaffold(
      appBar: currentUserId == null
          ? null
          : AppBar(
              title: Text(
                  threadId != null ? 'Thread' : '#${channelName ?? 'Teams'}'),
              actions: [
                  IconButton(
                      onPressed: searchMessages,
                      tooltip: 'Search messages',
                      icon: const Icon(Icons.search)),
                  if (wide)
                    IconButton(
                        onPressed: signOut,
                        tooltip: 'Sign out',
                        icon: const Icon(Icons.logout))
                ]),
      drawer: currentUserId != null && !wide
          ? Drawer(child: SafeArea(child: channelSidebar(drawer: true)))
          : null,
      body: SafeArea(
          child: currentUserId == null
              ? (connected ? loginPage() : serverPage())
              : Row(children: [
                  if (wide) channelSidebar(),
                  if (wide) const VerticalDivider(width: 1),
                  Expanded(
                      child: channelId == null
                          ? const Center(
                              child: Text('Choose a channel to get started'))
                          : chatPanel()),
                ])),
    );
  }
}
