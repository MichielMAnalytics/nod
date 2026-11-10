import 'attachments.dart';

enum NodMessageRole { owner, assistant, system }

enum NodTurnState {
  idle,
  queued,
  running,
  waiting,
  succeeded,
  failed,
  cancelled,
}

final class NodConnectionConfig {
  const NodConnectionConfig({required this.origin, required this.token});

  final Uri origin;
  final String token;

  @override
  String toString() =>
      'NodConnectionConfig(origin: $origin, token: [redacted])';
}

final class NodCapabilities {
  const NodCapabilities({
    required this.contractVersion,
    required this.authMode,
  });

  final int contractVersion;
  final String authMode;
}

final class NodSession {
  const NodSession({this.userId});

  final String? userId;
}

final class NodMessage {
  const NodMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.createdAt,
    this.clientMessageId,
    this.attachments = const [],
  });

  final String id;
  final String? clientMessageId;
  final List<NodArtifact> attachments;
  final NodMessageRole role;
  final String text;
  final DateTime createdAt;
}

final class NodState {
  const NodState({
    required this.messages,
    required this.turn,
    required this.revision,
    this.hiddenMessageIds = const [],
    this.hiddenMessageCount = 0,
  });

  final List<NodMessage> messages;
  final NodTurnState turn;
  final String revision;
  final List<String> hiddenMessageIds;
  final int hiddenMessageCount;
}

final class NodHistory {
  const NodHistory({required this.messages, this.nextCursor});

  final List<NodMessage> messages;
  final String? nextCursor;
}

sealed class NodEvent {
  const NodEvent();
}

final class NodRefreshEvent extends NodEvent {
  const NodRefreshEvent(this.state);

  final NodState state;
}

final class NodMessageEvent extends NodEvent {
  const NodMessageEvent(this.message);

  final NodMessage message;
}

final class NodMessageDeltaEvent extends NodEvent {
  const NodMessageDeltaEvent({
    required this.messageId,
    required this.text,
    this.threadId,
    this.turnId,
    this.streamId,
    this.done = false,
  });

  final String messageId;
  final String text;
  final String? threadId;
  final String? turnId;
  final String? streamId;
  final bool done;
}

final class NodActivity {
  const NodActivity({
    required this.turnId,
    this.taskId,
    this.title,
    this.step,
    this.site,
    this.since,
  });

  final String turnId;
  final String? taskId;
  final String? title;
  final String? step;
  final String? site;
  final DateTime? since;
}

final class NodActivityEvent extends NodEvent {
  const NodActivityEvent(this.turn, {this.items = const []});

  final NodTurnState turn;
  final List<NodActivity> items;
}
