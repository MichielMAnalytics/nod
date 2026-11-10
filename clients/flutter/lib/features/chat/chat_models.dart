import '../../core/attachments.dart';
import '../../core/core.dart';

enum ChatFailureKind {
  offline,
  unauthorized,
  conversationReset,
  audio,
  unknown,
}

final class ChatRepositoryException implements Exception {
  const ChatRepositoryException(this.kind, {this.detail});

  final ChatFailureKind kind;
  final String? detail;

  @override
  String toString() => detail ?? kind.name;
}

final class ChatFailure {
  const ChatFailure(this.kind, {this.detail});

  final ChatFailureKind kind;
  final String? detail;

  bool get canRetry =>
      kind == ChatFailureKind.offline || kind == ChatFailureKind.unknown;
}

enum ChatQuestionStyle { choice, approval }

final class ChatChoice {
  const ChatChoice({required this.label, required this.value});

  final String label;
  final String value;
}

final class ChatQuestion {
  const ChatQuestion({
    required this.id,
    required this.prompt,
    required this.choices,
    this.style = ChatQuestionStyle.choice,
  });

  final String id;
  final String prompt;
  final List<ChatChoice> choices;
  final ChatQuestionStyle style;
}

abstract interface class ChatQuestionSource {
  Stream<ChatQuestion?> get questions;
}

final class ChatMessageItem {
  const ChatMessageItem({
    required this.id,
    required this.role,
    required this.text,
    required this.createdAt,
    this.clientMessageId,
    this.attachments = const [],
    this.isPending = false,
    this.isStreaming = false,
  });

  factory ChatMessageItem.fromMessage(NodMessage message) {
    return ChatMessageItem(
      id: message.id,
      clientMessageId: message.clientMessageId,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      attachments: message.attachments,
    );
  }

  final String id;
  final String? clientMessageId;
  final List<NodArtifact> attachments;
  final NodMessageRole role;
  final String text;
  final DateTime createdAt;
  final bool isPending;
  final bool isStreaming;

  ChatMessageItem copyWith({
    String? id,
    String? text,
    bool? isPending,
    bool? isStreaming,
  }) {
    return ChatMessageItem(
      id: id ?? this.id,
      clientMessageId: clientMessageId,
      role: role,
      text: text ?? this.text,
      createdAt: createdAt,
      attachments: attachments,
      isPending: isPending ?? this.isPending,
      isStreaming: isStreaming ?? this.isStreaming,
    );
  }
}
