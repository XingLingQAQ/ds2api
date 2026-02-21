package openai

import (
	"ds2api/internal/deepseek"
)

func buildOpenAIFinalPrompt(messagesRaw []any, toolsRaw any, traceID string) (string, []string) {
	messages := normalizeOpenAIMessagesForPrompt(messagesRaw, traceID)
	toolNames := []string{}
	if tools, ok := toolsRaw.([]any); ok && len(tools) > 0 {
		messages, toolNames = injectToolPrompt(messages, tools)
	}
	return deepseek.MessagesPrepare(messages), toolNames
}
