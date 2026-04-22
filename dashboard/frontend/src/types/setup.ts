export interface SetupState {
  setupMode: boolean;
  listenerPort: number;
  models: number;
  decisions: number;
  hasModels: boolean;
  hasDecisions: boolean;
  canActivate: boolean;
}

export interface SetupValidateResponse {
  valid: boolean;
  config?: Record<string, unknown>;
  models: number;
  decisions: number;
  signals: number;
  canActivate: boolean;
}

export interface SetupActivateResponse {
  status: string;
  setupMode: boolean;
  message?: string;
}

export interface SetupImportRemoteResponse {
  config: Record<string, unknown>;
  models: number;
  decisions: number;
  signals: number;
  canActivate: boolean;
  sourceUrl: string;
}

export interface SetupModeModel {
  name: string;
  provider_model_id?: string;
  role: string;
  reason: string;
  configured?: boolean;
}

export interface SetupMode {
  id: string;
  label: string;
  summary: string;
  tradeoff: string;
  source_type: string;
  required_models: SetupModeModel[];
}

export interface SetupModesResponse {
  modes: SetupMode[];
}

export interface SetupModeDeltaResponse {
  mode: SetupMode;
  configured_models: SetupModeModel[];
  missing_models: SetupModeModel[];
}

export interface SetupModeImportResponse {
  config: Record<string, unknown>;
  models: number;
  decisions: number;
  signals: number;
  canActivate: boolean;
  modeId: string;
  sourceLabel: string;
}
