package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestSetupModesHandlerListsBalanceAndSecurity(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/setup/modes", nil)
	w := httptest.NewRecorder()

	SetupModesHandler("", "")(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SetupModeCatalogResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	var ids []string
	for _, mode := range resp.Modes {
		ids = append(ids, mode.ID)
		if mode.ID == "security" && mode.Label != "Security & Privacy" {
			t.Fatalf("expected security label to be Security & Privacy, got %q", mode.Label)
		}
	}
	if !reflect.DeepEqual(ids, []string{"balance", "security"}) {
		t.Fatalf("expected modes [balance security], got %#v", ids)
	}
}

func TestSetupModesHandlerUnknownModeReturnsNotFound(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/setup/modes/accuracy/delta", nil)
	w := httptest.NewRecorder()

	SetupModesHandler("", "")(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", w.Code)
	}
}

func TestSetupModeDeltaListsBalanceRequiredModels(t *testing.T) {
	configPath := createBootstrapSetupConfig(t, t.TempDir())
	req := httptest.NewRequest(http.MethodGet, "/api/setup/modes/balance/delta", nil)
	w := httptest.NewRecorder()

	SetupModesHandler(configPath, "")(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SetupModeDeltaResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Mode.RequiredModels) != 5 {
		t.Fatalf("expected 5 required balance models, got %d", len(resp.Mode.RequiredModels))
	}
	if len(resp.MissingModels) != 5 {
		t.Fatalf("expected 5 missing balance models, got %d", len(resp.MissingModels))
	}
}

func TestSetupModeDeltaMatchesConfiguredProviderModelID(t *testing.T) {
	tempDir := t.TempDir()
	configPath := createSetupConfigWithProviderModels(t, tempDir, []map[string]interface{}{
		{
			"name":              "workspace-local-qwen",
			"provider_model_id": "qwen/qwen3.5-rocm",
			"backend_refs": []map[string]interface{}{
				{
					"name":     "primary",
					"endpoint": "host.docker.internal:8000",
					"protocol": "http",
					"weight":   1,
				},
			},
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/setup/modes/security/delta", nil)
	w := httptest.NewRecorder()

	SetupModesHandler(configPath, "")(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SetupModeDeltaResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	configuredNames := sortedSetupModeModelNames(resp.ConfiguredModels)
	missingNames := sortedSetupModeModelNames(resp.MissingModels)
	if !reflect.DeepEqual(configuredNames, []string{"local/private-qwen"}) {
		t.Fatalf("expected local/private-qwen configured via provider_model_id, got %#v", configuredNames)
	}
	if !reflect.DeepEqual(missingNames, []string{"cloud/frontier-reasoning"}) {
		t.Fatalf("expected cloud/frontier-reasoning missing, got %#v", missingNames)
	}
}

func TestSetupModeImportUsesAllowlistedRecipe(t *testing.T) {
	configPath := createBootstrapSetupConfig(t, t.TempDir())
	req := httptest.NewRequest(http.MethodPost, "/api/setup/modes/security/import", nil)
	w := httptest.NewRecorder()

	SetupModesHandler(configPath, "")(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SetupModeImportResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ModeID != "security" {
		t.Fatalf("expected modeId=security, got %q", resp.ModeID)
	}
	if resp.SourceLabel != "Security & Privacy" {
		t.Fatalf("expected source label Security & Privacy, got %q", resp.SourceLabel)
	}
	if resp.Models != 2 || !resp.CanActivate {
		t.Fatalf("expected security recipe to import 2 models and be activatable, got models=%d canActivate=%t", resp.Models, resp.CanActivate)
	}
}

func createSetupConfigWithProviderModels(t *testing.T, dir string, models []map[string]interface{}) string {
	t.Helper()

	configPath := filepath.Join(dir, "config.yaml")
	config := map[string]interface{}{
		"version": "v0.3",
		"listeners": []map[string]interface{}{
			{
				"name":    "http-8899",
				"address": "0.0.0.0",
				"port":    8899,
				"timeout": "300s",
			},
		},
		"setup": map[string]interface{}{
			"mode":  true,
			"state": "bootstrap",
		},
		"providers": map[string]interface{}{
			"models": models,
		},
	}

	data, err := yaml.Marshal(config)
	if err != nil {
		t.Fatalf("failed to marshal config: %v", err)
	}
	if err := os.WriteFile(configPath, data, 0o644); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}
	return configPath
}
