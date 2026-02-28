package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthEndpointsSupportHEAD(t *testing.T) {
	app := NewApp()

	for _, path := range []string{"/healthz", "/readyz"} {
		req := httptest.NewRequest(http.MethodHead, path, nil)
		rec := httptest.NewRecorder()
		app.Router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected %s HEAD status 200, got %d", path, rec.Code)
		}
	}
}
