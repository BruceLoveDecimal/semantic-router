package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type SetupModeModel struct {
	Name            string `json:"name"`
	ProviderModelID string `json:"provider_model_id,omitempty"`
	Role            string `json:"role"`
	Reason          string `json:"reason"`
	Configured      bool   `json:"configured,omitempty"`
}

type SetupModeCatalogEntry struct {
	ID             string           `json:"id"`
	Label          string           `json:"label"`
	Summary        string           `json:"summary"`
	Tradeoff       string           `json:"tradeoff"`
	SourceType     string           `json:"source_type"`
	RequiredModels []SetupModeModel `json:"required_models"`
}

type SetupModeCatalogResponse struct {
	Modes []SetupModeCatalogEntry `json:"modes"`
}

type SetupModeDeltaResponse struct {
	Mode             SetupModeCatalogEntry `json:"mode"`
	ConfiguredModels []SetupModeModel      `json:"configured_models"`
	MissingModels    []SetupModeModel      `json:"missing_models"`
}

type SetupModeImportResponse struct {
	Config      json.RawMessage `json:"config"`
	Models      int             `json:"models"`
	Decisions   int             `json:"decisions"`
	Signals     int             `json:"signals"`
	CanActivate bool            `json:"canActivate"`
	ModeID      string          `json:"modeId"`
	SourceLabel string          `json:"sourceLabel"`
}

type setupModeCatalogItem struct {
	SetupModeCatalogEntry
	RecipePath string
}

var setupModeCatalog = []setupModeCatalogItem{
	{
		SetupModeCatalogEntry: SetupModeCatalogEntry{
			ID:         "balance",
			Label:      "Balance",
			Summary:    "Default trade-off between cost, quality, and safety.",
			Tradeoff:   "Uses the maintained balance profile and may require simple, medium, complex, reasoning, and premium model tiers.",
			SourceType: "recipe",
			RequiredModels: []SetupModeModel{
				{Name: "qwen/qwen3.5-rocm", ProviderModelID: "qwen/qwen3.5-rocm", Role: "simple", Reason: "Fast self-hosted default for broad fallback and simple traffic."},
				{Name: "google/gemini-2.5-flash-lite", ProviderModelID: "google/gemini-2.5-flash-lite", Role: "medium", Reason: "Low-cost lane for verified explanation and correction tasks."},
				{Name: "google/gemini-3.1-pro", ProviderModelID: "google/gemini-3.1-pro", Role: "complex", Reason: "Generalist lane for complex reasoning, coding, and synthesis."},
				{Name: "openai/gpt5.4", ProviderModelID: "openai/gpt5.4", Role: "reasoning", Reason: "High-reasoning lane for formal proof and verification-heavy work."},
				{Name: "anthropic/claude-opus-4.6", ProviderModelID: "anthropic/claude-opus-4.6", Role: "premium", Reason: "Premium lane for high-value legal and compliance analysis."},
			},
		},
		RecipePath: filepath.Join("deploy", "recipes", "balance.yaml"),
	},
	{
		SetupModeCatalogEntry: SetupModeCatalogEntry{
			ID:         "security",
			Label:      "Security & Privacy",
			Summary:    "Keep sensitive or suspicious traffic on local infrastructure, and escalate only clearly non-sensitive deep-reasoning work.",
			Tradeoff:   "Prioritizes local containment, PII/private-code handling, prompt-injection resistance, and auditable routing over maximum model breadth.",
			SourceType: "recipe",
			RequiredModels: []SetupModeModel{
				{Name: "local/private-qwen", ProviderModelID: "qwen/qwen3.5-rocm", Role: "local containment", Reason: "Handles privacy-sensitive, suspicious, and default local traffic."},
				{Name: "cloud/frontier-reasoning", ProviderModelID: "anthropic/claude-opus-4.6", Role: "frontier reasoning", Reason: "Reserved for non-sensitive architecture, synthesis, and deep reasoning."},
			},
		},
		RecipePath: filepath.Join("deploy", "recipes", "privacy", "privacy-router.yaml"),
	},
}

func SetupModesHandler(configPath string, routerAPIURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimSuffix(r.URL.Path, "/")
		if path == "/api/setup/modes" {
			if r.Method != http.MethodGet {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			writeSetupModesCatalog(w)
			return
		}

		modeID, action, ok := parseSetupModeAction(path)
		if !ok {
			http.NotFound(w, r)
			return
		}

		mode, ok := findSetupMode(modeID)
		if !ok {
			http.NotFound(w, r)
			return
		}

		switch action {
		case "delta":
			if r.Method != http.MethodGet {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			writeSetupModeDelta(w, configPath, routerAPIURL, mode)
		case "import":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			writeSetupModeImport(w, r, configPath, mode)
		default:
			http.NotFound(w, r)
		}
	}
}

func writeSetupModesCatalog(w http.ResponseWriter) {
	modes := make([]SetupModeCatalogEntry, 0, len(setupModeCatalog))
	for _, mode := range setupModeCatalog {
		modes = append(modes, cloneSetupModeCatalogEntry(mode.SetupModeCatalogEntry))
	}
	writeJSONResponse(w, SetupModeCatalogResponse{Modes: modes})
}

func parseSetupModeAction(path string) (string, string, bool) {
	const prefix = "/api/setup/modes/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func findSetupMode(modeID string) (setupModeCatalogItem, bool) {
	for _, mode := range setupModeCatalog {
		if mode.ID == modeID {
			return mode, true
		}
	}
	return setupModeCatalogItem{}, false
}

func writeSetupModeDelta(w http.ResponseWriter, configPath string, routerAPIURL string, mode setupModeCatalogItem) {
	configured, err := collectConfiguredSetupModeModels(configPath, routerAPIURL)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read configured models: %v", err), http.StatusInternalServerError)
		return
	}

	configuredModels := make([]SetupModeModel, 0, len(mode.RequiredModels))
	missingModels := make([]SetupModeModel, 0, len(mode.RequiredModels))
	modeEntry := cloneSetupModeCatalogEntry(mode.SetupModeCatalogEntry)
	for i := range modeEntry.RequiredModels {
		model := modeEntry.RequiredModels[i]
		model.Configured = isSetupModeModelConfigured(model, configured)
		modeEntry.RequiredModels[i] = model
		if model.Configured {
			configuredModels = append(configuredModels, model)
		} else {
			missingModels = append(missingModels, model)
		}
	}

	writeJSONResponse(w, SetupModeDeltaResponse{
		Mode:             modeEntry,
		ConfiguredModels: configuredModels,
		MissingModels:    missingModels,
	})
}

func writeSetupModeImport(w http.ResponseWriter, r *http.Request, configPath string, mode setupModeCatalogItem) {
	if _, err := loadBootstrapConfig(configPath); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	recipePath, err := resolveSetupModeRecipePath(configPath, mode.RecipePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	body, err := os.ReadFile(recipePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read mode recipe: %v", err), http.StatusInternalServerError)
		return
	}

	recipeConfig, err := parseSetupCanonicalConfig(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if validationErr := validateSetupCandidate(configPath, recipeConfig); validationErr != nil {
		http.Error(w, fmt.Sprintf("mode recipe validation failed: %v", validationErr), http.StatusBadRequest)
		return
	}

	summary := summarizeSetupConfig(&recipeConfig.CanonicalConfig)
	configJSON, err := rawJSONMessage(recipeConfig.CanonicalConfig)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to encode mode config: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, SetupModeImportResponse{
		Config:      configJSON,
		Models:      summary.Models,
		Decisions:   summary.Decisions,
		Signals:     summary.Signals,
		CanActivate: summary.Models > 0 && summary.Decisions > 0,
		ModeID:      mode.ID,
		SourceLabel: mode.Label,
	})
}

func collectConfiguredSetupModeModels(configPath string, routerAPIURL string) (map[string]bool, error) {
	configured := map[string]bool{}
	configFile, err := readSetupConfigFile(configPath)
	if err != nil {
		return nil, err
	}

	for _, model := range configFile.Providers.Models {
		addSetupModeModelIdentifier(configured, model.Name)
		addSetupModeModelIdentifier(configured, model.ProviderModelID)
		for _, externalID := range model.ExternalModelIDs {
			addSetupModeModelIdentifier(configured, externalID)
		}
	}
	for _, model := range configFile.Routing.ModelCards {
		addSetupModeModelIdentifier(configured, model.Name)
	}

	if runtimeModels := fetchRouterModelsInfo(routerAPIURL); runtimeModels != nil {
		for _, model := range runtimeModels.Models {
			addSetupModeModelIdentifier(configured, model.Name)
			addSetupModeModelIdentifier(configured, model.ModelPath)
			addSetupModeModelIdentifier(configured, model.ResolvedModelPath)
			if model.Registry != nil {
				addSetupModeModelIdentifier(configured, model.Registry.LocalPath)
				addSetupModeModelIdentifier(configured, model.Registry.RepoID)
			}
		}
	}

	return configured, nil
}

func isSetupModeModelConfigured(model SetupModeModel, configured map[string]bool) bool {
	return configured[normalizeSetupModeModelIdentifier(model.Name)] ||
		configured[normalizeSetupModeModelIdentifier(model.ProviderModelID)]
}

func addSetupModeModelIdentifier(configured map[string]bool, value string) {
	normalized := normalizeSetupModeModelIdentifier(value)
	if normalized != "" {
		configured[normalized] = true
	}
}

func normalizeSetupModeModelIdentifier(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func resolveSetupModeRecipePath(configPath string, relPath string) (string, error) {
	cleanRelPath := filepath.Clean(relPath)
	if filepath.IsAbs(cleanRelPath) || strings.HasPrefix(cleanRelPath, ".."+string(filepath.Separator)) || cleanRelPath == ".." {
		return "", fmt.Errorf("mode recipe path is not allowlisted")
	}

	candidates := setupModeProjectRootCandidates(configPath)
	for _, root := range candidates {
		candidate := filepath.Join(root, cleanRelPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("mode recipe %q was not found", cleanRelPath)
}

func setupModeProjectRootCandidates(configPath string) []string {
	seen := map[string]bool{}
	var candidates []string
	addCandidate := func(path string) {
		if path == "" {
			return
		}
		clean := filepath.Clean(path)
		if seen[clean] {
			return
		}
		seen[clean] = true
		candidates = append(candidates, clean)
	}

	for _, start := range []string{filepath.Dir(configPath), filepath.Dir(filepath.Dir(configPath))} {
		for _, dir := range ancestorDirs(start) {
			addCandidate(dir)
		}
	}
	if wd, err := os.Getwd(); err == nil {
		for _, dir := range ancestorDirs(wd) {
			addCandidate(dir)
		}
	}

	return candidates
}

func ancestorDirs(start string) []string {
	var dirs []string
	if start == "" || start == "." {
		return dirs
	}
	dir := filepath.Clean(start)
	for {
		dirs = append(dirs, dir)
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return dirs
}

func cloneSetupModeCatalogEntry(entry SetupModeCatalogEntry) SetupModeCatalogEntry {
	entry.RequiredModels = append([]SetupModeModel(nil), entry.RequiredModels...)
	return entry
}

func writeJSONResponse(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

func sortedSetupModeModelNames(models []SetupModeModel) []string {
	names := make([]string, 0, len(models))
	for _, model := range models {
		names = append(names, model.Name)
	}
	sort.Strings(names)
	return names
}
