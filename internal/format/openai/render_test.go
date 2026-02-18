package openai

import (
	"encoding/json"
	"testing"
)

func TestBuildResponseObjectToolCallsFollowChatShape(t *testing.T) {
	obj := BuildResponseObject(
		"resp_test",
		"gpt-4o",
		"prompt",
		"",
		`{"tool_calls":[{"name":"search","input":{"q":"golang"}}]}`,
		[]string{"search"},
	)

	outputText, _ := obj["output_text"].(string)
	if outputText != "" {
		t.Fatalf("expected output_text to be hidden for tool calls, got %q", outputText)
	}

	output, _ := obj["output"].([]any)
	if len(output) != 1 {
		t.Fatalf("expected one tool_calls wrapper, got %#v", obj["output"])
	}

	first, _ := output[0].(map[string]any)
	if first["type"] != "tool_calls" {
		t.Fatalf("expected first output item type tool_calls, got %#v", first["type"])
	}
	var toolCalls []map[string]any
	switch v := first["tool_calls"].(type) {
	case []map[string]any:
		toolCalls = v
	case []any:
		toolCalls = make([]map[string]any, 0, len(v))
		for _, item := range v {
			m, _ := item.(map[string]any)
			if m != nil {
				toolCalls = append(toolCalls, m)
			}
		}
	}
	if len(toolCalls) != 1 {
		t.Fatalf("expected one tool call, got %#v", first["tool_calls"])
	}
	tc := toolCalls[0]
	if tc["type"] != "function" || tc["id"] == "" {
		t.Fatalf("unexpected tool call shape: %#v", tc)
	}
	fn, _ := tc["function"].(map[string]any)
	if fn["name"] != "search" {
		t.Fatalf("unexpected function name: %#v", fn["name"])
	}
	argsRaw, _ := fn["arguments"].(string)
	var args map[string]any
	if err := json.Unmarshal([]byte(argsRaw), &args); err != nil {
		t.Fatalf("arguments should be valid json string, got=%q err=%v", argsRaw, err)
	}
	if args["q"] != "golang" {
		t.Fatalf("unexpected arguments: %#v", args)
	}
}
