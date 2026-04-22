import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ColorBends from "../components/ColorBends";
import { useReadonly } from "../contexts/ReadonlyContext";
import { useSetup } from "../contexts/SetupContext";
import { markOnboardingPending } from "../utils/onboarding";
import {
  activateSetupConfig,
  fetchSetupModeDelta,
  fetchSetupModes,
  importSetupMode,
  importRemoteSetupConfig,
  validateSetupConfig,
} from "../utils/setupApi";
import type { SetupMode, SetupModeDeltaResponse } from "../types/setup";
import {
  ModelStepPanel,
  RoutingStarterPanel,
  SetupWizardStepper,
} from "./SetupWizardPanels";
import { ReviewActivatePanel } from "./SetupWizardReviewPanel";
import {
  buildSetupConfig,
  countConfigSignals,
  createModelDraft,
  createSetupConfigCounts,
  DEFAULT_REMOTE_SETUP_CONFIG_URL,
  getStepOneErrors,
  maskSecrets,
  type ModeImportState,
  PROVIDER_OPTIONS,
  type ImportedSetupConfig,
  type ModelDraft,
  type ProviderKind,
  type RemoteImportState,
  type SetupActivationState,
  type SetupRoutingMode,
  type SetupStep,
  type SetupValidationState,
} from "./setupWizardSupport";
import styles from "./SetupWizardPage.module.css";

const SetupWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const { setupState, refreshSetupState } = useSetup();
  const { isReadonly, isLoading: readonlyLoading } = useReadonly();

  const [currentStep, setCurrentStep] = useState<SetupStep>(0);
  const [models, setModels] = useState<ModelDraft[]>([createModelDraft(1)]);
  const [defaultModelId, setDefaultModelId] = useState<string>("");
  const [routingMode, setRoutingMode] = useState<SetupRoutingMode>("scratch");
  const [setupModes, setSetupModes] = useState<SetupMode[]>([]);
  const [setupModesError, setSetupModesError] = useState<string | null>(null);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [modeDelta, setModeDelta] = useState<SetupModeDeltaResponse | null>(
    null,
  );
  const [modeImportState, setModeImportState] =
    useState<ModeImportState>("idle");
  const [modeImportError, setModeImportError] = useState<string | null>(null);
  const [importedModeConfig, setImportedModeConfig] =
    useState<ImportedSetupConfig | null>(null);
  const [remoteConfigUrl, setRemoteConfigUrl] = useState(
    DEFAULT_REMOTE_SETUP_CONFIG_URL,
  );
  const [remoteImportState, setRemoteImportState] =
    useState<RemoteImportState>("idle");
  const [remoteImportError, setRemoteImportError] = useState<string | null>(
    null,
  );
  const [importedRemoteConfig, setImportedRemoteConfig] =
    useState<ImportedSetupConfig | null>(null);
  const [stepOneAttempted, setStepOneAttempted] = useState(false);
  const [validationState, setValidationState] =
    useState<SetupValidationState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedConfig, setValidatedConfig] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [validatedCounts, setValidatedCounts] = useState(
    createSetupConfigCounts(),
  );
  const [activationState, setActivationState] =
    useState<SetupActivationState>("idle");
  const [activationError, setActivationError] = useState<string | null>(null);

  useEffect(() => {
    if (models.length === 0) {
      setDefaultModelId("");
      return;
    }

    if (
      !defaultModelId ||
      !models.some((model) => model.id === defaultModelId)
    ) {
      setDefaultModelId(models[0].id);
    }
  }, [models, defaultModelId]);

  useEffect(() => {
    let cancelled = false;

    const loadModes = async () => {
      try {
        const result = await fetchSetupModes();
        if (cancelled) {
          return;
        }
        setSetupModes(result.modes);
        setSetupModesError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setSetupModes([]);
        setSetupModesError(
          err instanceof Error ? err.message : "Failed to load routing modes.",
        );
      }
    };

    void loadModes();

    return () => {
      cancelled = true;
    };
  }, []);

  const stepOneErrors = getStepOneErrors(models, defaultModelId);
  const hasStepOneIssues = stepOneErrors.length > 0;
  const shouldShowStepOneIssues = stepOneAttempted && hasStepOneIssues;

  const resetReviewState = () => {
    setValidationState("idle");
    setValidationError(null);
    setValidatedConfig(null);
    setValidatedCounts(createSetupConfigCounts());
    setActivationState("idle");
    setActivationError(null);
  };

  let scratchConfig: Record<string, unknown> | null = null;
  let scratchBuildError: string | null = null;
  if (stepOneErrors.length === 0) {
    try {
      scratchConfig = buildSetupConfig(models, defaultModelId);
    } catch (err) {
      scratchBuildError =
        err instanceof Error ? err.message : "Failed to build setup config.";
    }
  }

  const scratchCounts = createSetupConfigCounts({
    models: models.length,
    decisions: Array.isArray(scratchConfig?.decisions)
      ? scratchConfig.decisions.length
      : 0,
    signals: countConfigSignals(scratchConfig?.signals),
    canActivate:
      models.length > 0 &&
      Array.isArray(scratchConfig?.decisions) &&
      scratchConfig.decisions.length > 0,
  });

  const selectedSetupMode = setupModes.find((mode) => mode.id === selectedModeId);
  const currentRouteLabel =
    routingMode === "remote"
      ? "From remote"
      : routingMode === "mode" && selectedSetupMode
        ? selectedSetupMode.label
        : "From scratch";
  const draftConfig =
    routingMode === "remote"
      ? (importedRemoteConfig?.config ?? null)
      : routingMode === "mode"
        ? (importedModeConfig?.config ?? null)
      : scratchConfig;
  const generatedCounts =
    routingMode === "remote"
      ? (importedRemoteConfig?.counts ?? createSetupConfigCounts())
      : routingMode === "mode"
        ? (importedModeConfig?.counts ?? createSetupConfigCounts())
      : scratchCounts;

  const previewSource = maskSecrets(validatedConfig ?? draftConfig);
  const validationSignature = draftConfig ? JSON.stringify(draftConfig) : "";

  useEffect(() => {
    if (currentStep !== 2 || !validationSignature) {
      return;
    }

    let cancelled = false;
    // Scratch configs are rebuilt on every render, so key auto-validation off a
    // stable serialized payload instead of object identity.
    const validationPayload = JSON.parse(validationSignature) as Record<
      string,
      unknown
    >;

    const runValidation = async () => {
      setValidationState("validating");
      setValidationError(null);
      setActivationError(null);

      try {
        const result = await validateSetupConfig(validationPayload);
        if (cancelled) {
          return;
        }

        setValidatedConfig(result.config ?? validationPayload);
        setValidatedCounts({
          models: result.models,
          decisions: result.decisions,
          signals: result.signals,
          canActivate: result.canActivate,
        });
        setValidationState(result.valid ? "valid" : "error");
      } catch (err) {
        if (cancelled) {
          return;
        }

        setValidatedConfig(null);
        setValidatedCounts(createSetupConfigCounts());
        setValidationState("error");
        setValidationError(
          err instanceof Error ? err.message : "Setup validation failed.",
        );
      }
    };

    void runValidation();

    return () => {
      cancelled = true;
    };
  }, [currentStep, validationSignature]);

  const addModel = () => {
    setModels((prev) => [...prev, createModelDraft(prev.length + 1)]);
    resetReviewState();
  };

  const updateModel = (id: string, field: keyof ModelDraft, value: string) => {
    setModels((prev) =>
      prev.map((model) => {
        if (model.id !== id) {
          return model;
        }

        if (field === "providerKind") {
          const nextProvider = value as ProviderKind;
          const nextPlaceholder = PROVIDER_OPTIONS.find(
            (option) => option.id === nextProvider,
          )?.placeholder;
          return {
            ...model,
            providerKind: nextProvider,
            baseUrl: model.baseUrl.trim()
              ? model.baseUrl
              : nextPlaceholder || model.baseUrl,
          };
        }

        return { ...model, [field]: value };
      }),
    );

    resetReviewState();
  };

  const removeModel = (id: string) => {
    setModels((prev) => prev.filter((model) => model.id !== id));
    resetReviewState();
  };

  const goToStep = (step: SetupStep) => {
    if (step > 0 && (hasStepOneIssues || scratchBuildError)) {
      setStepOneAttempted(true);
      return;
    }

    if (step === 2 && routingMode === "remote" && !importedRemoteConfig) {
      setRemoteImportError("Import a remote config before continuing.");
      return;
    }
    if (step === 2 && routingMode === "mode" && !importedModeConfig) {
      setModeImportError("Prepare the selected routing mode before continuing.");
      return;
    }

    setCurrentStep(step);
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      if (hasStepOneIssues || scratchBuildError) {
        setStepOneAttempted(true);
        return;
      }

      setCurrentStep(1);
      return;
    }

    if (
      currentStep === 1 &&
      routingMode === "remote" &&
      !importedRemoteConfig
    ) {
      setRemoteImportError("Import a remote config before continuing.");
      return;
    }

    if (currentStep === 1 && routingMode === "mode") {
      if (!selectedModeId) {
        setModeImportError("Choose a routing mode before continuing.");
        return;
      }
      if (!importedModeConfig) {
        const imported = await handleImportMode();
        if (!imported) {
          return;
        }
      }
    }

    setCurrentStep((prev) => (prev === 2 ? prev : ((prev + 1) as SetupStep)));
  };

  const handleBack = () => {
    setCurrentStep((prev) => (prev === 0 ? prev : ((prev - 1) as SetupStep)));
  };

  const handleValidateAgain = async () => {
    if (!draftConfig) {
      return;
    }

    setValidationState("validating");
    setValidationError(null);

    try {
      const result = await validateSetupConfig(draftConfig);
      setValidatedConfig(result.config ?? draftConfig);
      setValidatedCounts({
        models: result.models,
        decisions: result.decisions,
        signals: result.signals,
        canActivate: result.canActivate,
      });
      setValidationState(result.valid ? "valid" : "error");
    } catch (err) {
      setValidatedConfig(null);
      setValidatedCounts(createSetupConfigCounts());
      setValidationState("error");
      setValidationError(
        err instanceof Error ? err.message : "Setup validation failed.",
      );
    }
  };

  const handleImportRemote = async () => {
    const trimmedUrl = remoteConfigUrl.trim();
    if (!trimmedUrl) {
      setRemoteImportState("error");
      setRemoteImportError("Paste a remote config URL before importing.");
      return;
    }

    setRemoteImportState("importing");
    setRemoteImportError(null);
    resetReviewState();

    try {
      const result = await importRemoteSetupConfig(trimmedUrl);
      setImportedRemoteConfig({
        config: result.config,
        sourceUrl: result.sourceUrl,
        counts: createSetupConfigCounts({
          models: result.models,
          decisions: result.decisions,
          signals: result.signals,
          canActivate: result.canActivate,
        }),
      });
      setRemoteConfigUrl(result.sourceUrl);
      setRemoteImportState("imported");
    } catch (err) {
      setImportedRemoteConfig(null);
      setRemoteImportState("error");
      setRemoteImportError(
        err instanceof Error ? err.message : "Remote import failed.",
      );
    }
  };

  const handleSelectSetupMode = async (modeId: string) => {
    setRoutingMode("mode");
    setSelectedModeId(modeId);
    setModeDelta(null);
    setModeImportState("idle");
    setModeImportError(null);
    setImportedModeConfig(null);
    setRemoteImportError(null);
    resetReviewState();

    try {
      const result = await fetchSetupModeDelta(modeId);
      setModeDelta(result);
    } catch (err) {
      setModeImportError(
        err instanceof Error ? err.message : "Failed to inspect routing mode.",
      );
    }
  };

  const handleImportMode = async (): Promise<boolean> => {
    if (!selectedModeId) {
      setModeImportState("error");
      setModeImportError("Choose a routing mode before importing.");
      return false;
    }

    setModeImportState("importing");
    setModeImportError(null);
    resetReviewState();

    try {
      const result = await importSetupMode(selectedModeId);
      setImportedModeConfig({
        config: result.config,
        sourceUrl: `Built-in mode: ${result.sourceLabel}`,
        counts: createSetupConfigCounts({
          models: result.models,
          decisions: result.decisions,
          signals: result.signals,
          canActivate: result.canActivate,
        }),
      });
      setModeImportState("imported");
      return true;
    } catch (err) {
      setImportedModeConfig(null);
      setModeImportState("error");
      setModeImportError(
        err instanceof Error ? err.message : "Mode import failed.",
      );
      return false;
    }
  };

  const handleActivate = async () => {
    if (!draftConfig || validationState !== "valid") {
      return;
    }

    setActivationState("activating");
    setActivationError(null);

    try {
      const payload = validatedConfig ?? draftConfig;
      await activateSetupConfig(payload);
      markOnboardingPending();
      await refreshSetupState();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setActivationState("error");
      setActivationError(
        err instanceof Error ? err.message : "Setup activation failed.",
      );
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.backgroundEffect}>
        <ColorBends
          colors={["#76b900", "#00b4d8", "#ffffff"]}
          rotation={20}
          speed={0.2}
          scale={1}
          frequency={1}
          warpStrength={1}
          mouseInfluence={1}
          parallax={0.5}
          noise={0.08}
          transparent
          autoRotate={0.8}
        />
      </div>

      <div className={styles.content}>
        <div className={styles.hero}>
          <div className={styles.heroHeader}>
            <div className={styles.heroBadge}>First-run setup</div>
          </div>
          <div className={styles.heroTitleRow}>
            <div className={styles.heroLogoWrap} aria-hidden="true">
              <img className={styles.heroLogo} src="/vllm.png" alt="" />
            </div>
            <h1 className={styles.heroTitle}>
              Configure a model first. Routing can follow.
            </h1>
          </div>
          <p className={styles.heroDescription}>
            Extract signals. Compose decisions. Route the best model.
          </p>
        </div>

        <SetupWizardStepper currentStep={currentStep} onGoToStep={goToStep} />

        <div className={styles.panel}>
          {currentStep === 0 && (
            <ModelStepPanel
              currentRouteLabel={currentRouteLabel}
              models={models}
              defaultModelId={defaultModelId}
              shouldShowStepOneIssues={shouldShowStepOneIssues}
              stepOneErrors={stepOneErrors}
              stepOneAttempted={stepOneAttempted}
              draftBuildError={scratchBuildError}
              onAddModel={addModel}
              onUpdateModel={updateModel}
              onRemoveModel={removeModel}
              onSelectDefaultModel={setDefaultModelId}
            />
          )}
          {currentStep === 1 && (
            <RoutingStarterPanel
              currentRouteLabel={currentRouteLabel}
              routingMode={routingMode}
              remoteConfigUrl={remoteConfigUrl}
              remoteImportState={remoteImportState}
              remoteImportError={remoteImportError}
              importedConfig={importedRemoteConfig}
              setupModes={setupModes}
              selectedModeId={selectedModeId}
              modeDelta={modeDelta}
              modeImportState={modeImportState}
              modeImportError={modeImportError ?? setupModesError}
              importedModeConfig={importedModeConfig}
              counts={generatedCounts}
              onSelectRoutingMode={(mode) => {
                setRoutingMode(mode);
                setRemoteImportError(null);
                setModeImportError(null);
                if (mode !== "mode") {
                  setSelectedModeId(null);
                  setModeDelta(null);
                  setImportedModeConfig(null);
                  setModeImportState("idle");
                }
                resetReviewState();
              }}
              onSelectSetupMode={(modeId) => void handleSelectSetupMode(modeId)}
              onChangeRemoteConfigUrl={(value) => {
                setRemoteConfigUrl(value);
                setRemoteImportError(null);
                if (
                  importedRemoteConfig &&
                  value.trim() !== importedRemoteConfig.sourceUrl
                ) {
                  setImportedRemoteConfig(null);
                  setRemoteImportState("idle");
                  resetReviewState();
                  return;
                }
                if (remoteImportState === "error") {
                  setRemoteImportState("idle");
                }
              }}
              onImportRemoteConfig={() => void handleImportRemote()}
              onImportSetupMode={() => void handleImportMode()}
            />
          )}
          {currentStep === 2 && (
            <ReviewActivatePanel
              currentRouteLabel={currentRouteLabel}
              listenerPort={setupState?.listenerPort}
              validationState={validationState}
              validationError={validationError}
              activationError={activationError}
              validatedCounts={validatedCounts}
              modelsCount={generatedCounts.models}
              generatedDecisions={generatedCounts.decisions}
              generatedSignals={generatedCounts.signals}
              previewSource={previewSource}
              readonlyLoading={readonlyLoading}
              isReadonly={isReadonly}
              onValidateAgain={() => void handleValidateAgain()}
            />
          )}

          <div className={styles.footer}>
            <div className={styles.footerActions}>
              {currentStep > 0 && (
                <button className={styles.secondaryButton} onClick={handleBack}>
                  Back
                </button>
              )}
              {currentStep < 2 && (
                <button
                  className={styles.primaryButton}
                  onClick={() => void handleNext()}
                  disabled={modeImportState === "importing"}
                >
                  Next
                </button>
              )}
              {currentStep === 2 && (
                <button
                  className={styles.primaryButton}
                  onClick={() => void handleActivate()}
                  disabled={
                    validationState !== "valid" ||
                    !validatedCounts.canActivate ||
                    activationState === "activating" ||
                    (!readonlyLoading && isReadonly)
                  }
                >
                  {activationState === "activating"
                    ? "Activating…"
                    : "Activate"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SetupWizardPage;
