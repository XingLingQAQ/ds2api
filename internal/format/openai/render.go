package openai

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"ds2api/internal/util"
)

func BuildChatCompletion(completionID, model, finalPrompt, finalThinking, finalText string, toolNames []string) map[string]any {
	detected := util.ParseToolCalls(finalText, toolNames)
	finishReason := "stop"
	messageObj := map[string]any{"role": "assistant", "content": finalText}
	if strings.TrimSpace(finalThinking) != "" {
		messageObj["reasoning_content"] = finalThinking
	}
	if len(detected) > 0 {
		finishReason = "tool_calls"
		messageObj["tool_calls"] = util.FormatOpenAIToolCalls(detected)
		messageObj["content"] = nil
	}
	promptTokens := util.EstimateTokens(finalPrompt)
	reasoningTokens := util.EstimateTokens(finalThinking)
	completionTokens := util.EstimateTokens(finalText)

	return map[string]any{
		"id":      completionID,
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   model,
		"choices": []map[string]any{{"index": 0, "message": messageObj, "finish_reason": finishReason}},
		"usage": map[string]any{
			"prompt_tokens":     promptTokens,
			"completion_tokens": reasoningTokens + completionTokens,
			"total_tokens":      promptTokens + reasoningTokens + completionTokens,
			"completion_tokens_details": map[string]any{
				"reasoning_tokens": reasoningTokens,
			},
		},
	}
}

func BuildResponseObject(responseID, model, finalPrompt, finalThinking, finalText string, toolNames []string) map[string]any {
	detected := util.ParseToolCalls(finalText, toolNames)
	exposedOutputText := finalText
	output := make([]any, 0, 2)
	if len(detected) > 0 {
		exposedOutputText = ""
		output = append(output, map[string]any{
			"type":       "tool_calls",
			"tool_calls": util.FormatOpenAIToolCalls(detected),
		})
	} else {
		content := []any{
			map[string]any{
				"type": "output_text",
				"text": finalText,
			},
		}
		if finalThinking != "" {
			content = append([]any{map[string]any{
				"type": "reasoning",
				"text": finalThinking,
			}}, content...)
		}
		output = append(output, map[string]any{
			"type":    "message",
			"id":      "msg_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
			"role":    "assistant",
			"content": content,
		})
	}
	promptTokens := util.EstimateTokens(finalPrompt)
	reasoningTokens := util.EstimateTokens(finalThinking)
	completionTokens := util.EstimateTokens(finalText)
	return map[string]any{
		"id":          responseID,
		"type":        "response",
		"object":      "response",
		"created_at":  time.Now().Unix(),
		"status":      "completed",
		"model":       model,
		"output":      output,
		"output_text": exposedOutputText,
		"usage": map[string]any{
			"input_tokens":  promptTokens,
			"output_tokens": reasoningTokens + completionTokens,
			"total_tokens":  promptTokens + reasoningTokens + completionTokens,
		},
	}
}

func BuildChatStreamDeltaChoice(index int, delta map[string]any) map[string]any {
	return map[string]any{
		"delta": delta,
		"index": index,
	}
}

func BuildChatStreamFinishChoice(index int, finishReason string) map[string]any {
	return map[string]any{
		"delta":         map[string]any{},
		"index":         index,
		"finish_reason": finishReason,
	}
}

func BuildChatStreamChunk(completionID string, created int64, model string, choices []map[string]any, usage map[string]any) map[string]any {
	out := map[string]any{
		"id":      completionID,
		"object":  "chat.completion.chunk",
		"created": created,
		"model":   model,
		"choices": choices,
	}
	if len(usage) > 0 {
		out["usage"] = usage
	}
	return out
}

func BuildChatUsage(finalPrompt, finalThinking, finalText string) map[string]any {
	promptTokens := util.EstimateTokens(finalPrompt)
	reasoningTokens := util.EstimateTokens(finalThinking)
	completionTokens := util.EstimateTokens(finalText)
	return map[string]any{
		"prompt_tokens":     promptTokens,
		"completion_tokens": reasoningTokens + completionTokens,
		"total_tokens":      promptTokens + reasoningTokens + completionTokens,
		"completion_tokens_details": map[string]any{
			"reasoning_tokens": reasoningTokens,
		},
	}
}

func BuildResponsesCreatedPayload(responseID, model string) map[string]any {
	return map[string]any{
		"type":   "response.created",
		"id":     responseID,
		"object": "response",
		"model":  model,
		"status": "in_progress",
	}
}

func BuildResponsesTextDeltaPayload(responseID, delta string) map[string]any {
	return map[string]any{
		"type":  "response.output_text.delta",
		"id":    responseID,
		"delta": delta,
	}
}

func BuildResponsesReasoningDeltaPayload(responseID, delta string) map[string]any {
	return map[string]any{
		"type":  "response.reasoning.delta",
		"id":    responseID,
		"delta": delta,
	}
}

func BuildResponsesToolCallDeltaPayload(responseID string, toolCalls []map[string]any) map[string]any {
	return map[string]any{
		"type":       "response.output_tool_call.delta",
		"id":         responseID,
		"tool_calls": toolCalls,
	}
}

func BuildResponsesToolCallDonePayload(responseID string, toolCalls []map[string]any) map[string]any {
	return map[string]any{
		"type":       "response.output_tool_call.done",
		"id":         responseID,
		"tool_calls": toolCalls,
	}
}

func BuildResponsesCompletedPayload(response map[string]any) map[string]any {
	return map[string]any{
		"type":     "response.completed",
		"response": response,
	}
}
