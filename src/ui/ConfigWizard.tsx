import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box, Text, useApp, useInput } from 'ink';
import { useState } from 'react';
import type { Config, ProviderName } from '../types.js';
import { Banner } from './components/Banner.js';
import { type SelectItem, SelectList } from './components/SelectList.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Step =
  | 'overwrite-confirm'
  | 'select-env-files'
  | 'select-providers'
  | 'select-ignore'
  | 'preview'
  | 'done';

const COMMON_IGNORE_KEYS = ['NODE_ENV', 'DEBUG', 'PORT', 'HOST', 'BROWSER', 'CI'];

export interface ConfigWizardResult {
  config: Config;
  filePath: string;
}

export interface ConfigWizardProps {
  projectRoot: string;
  detectedEnvFiles: string[];
  detectedProviders: ProviderName[];
  existingConfig?: Config;
  onComplete: (result: ConfigWizardResult) => void;
  onCancel: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ConfigWizard({
  projectRoot,
  detectedEnvFiles,
  detectedProviders,
  existingConfig,
  onComplete,
  onCancel,
}: ConfigWizardProps) {
  const { exit } = useApp();

  const initialStep: Step = existingConfig ? 'overwrite-confirm' : 'select-env-files';
  const [step, setStep] = useState<Step>(initialStep);

  // Env file selection
  const [envFileItems, setEnvFileItems] = useState<SelectItem[]>(() =>
    detectedEnvFiles.map((f) => ({
      label: f,
      value: f,
      selected: true,
    })),
  );
  const [envFileCursor, setEnvFileCursor] = useState(0);

  // Provider selection
  const allProviders: ProviderName[] = ['github', 'vercel', 'netlify'];
  const [providerItems, setProviderItems] = useState<SelectItem[]>(() =>
    allProviders.map((p) => ({
      label: p,
      value: p,
      selected: detectedProviders.includes(p),
      hint: detectedProviders.includes(p) ? 'detected' : undefined,
    })),
  );
  const [providerCursor, setProviderCursor] = useState(0);

  // Ignore key selection
  const [ignoreItems, setIgnoreItems] = useState<SelectItem[]>(() =>
    COMMON_IGNORE_KEYS.map((k) => ({
      label: k,
      value: k,
      selected: false,
    })),
  );
  const [ignoreCursor, setIgnoreCursor] = useState(0);

  // Error state
  const [writeError, setWriteError] = useState<string | null>(null);

  // ── Build config from selections ───────────────────────────────────────

  function buildConfig(): Config {
    const envFiles = envFileItems.filter((i) => i.selected).map((i) => i.value);
    const providers = providerItems.filter((i) => i.selected).map((i) => i.value as ProviderName);
    const ignore = ignoreItems.filter((i) => i.selected).map((i) => i.value);

    const config: Config = {};

    if (envFiles.length > 0) {
      config.envFiles = envFiles;
    }
    if (providers.length > 0) {
      config.providers = providers;
    }
    if (ignore.length > 0) {
      config.ignore = ignore;
    }

    return config;
  }

  // ── Overwrite confirm keyboard ─────────────────────────────────────────

  useInput(
    (input, key) => {
      if (step === 'overwrite-confirm') {
        if (input === 'y' || input === 'Y') {
          setStep('select-env-files');
        } else if (input === 'n' || input === 'N' || key.escape) {
          onCancel();
          exit();
        }
      }
    },
    { isActive: step === 'overwrite-confirm' },
  );

  // ── Preview / Done keyboard ────────────────────────────────────────────

  useInput(
    (input, key) => {
      if (step === 'preview') {
        if (key.return) {
          const config = buildConfig();
          const filePath = join(projectRoot, '.envguard.json');
          try {
            writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
            onComplete({ config, filePath });
            setStep('done');
          } catch (err) {
            setWriteError(err instanceof Error ? err.message : String(err));
            setStep('done');
          }
        } else if (key.escape) {
          setStep('select-ignore');
          setIgnoreCursor(0);
        }
      } else if (step === 'done') {
        if (key.return || input === 'q') {
          exit();
        }
      }
    },
    { isActive: step === 'preview' || step === 'done' },
  );

  // ── Env file selection handlers ────────────────────────────────────────

  const handleEnvFileToggle = (index: number) => {
    setEnvFileItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleEnvFileToggleAll = () => {
    const allSelected = envFileItems.every((i) => i.selected);
    setEnvFileItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  };

  const handleEnvFileSubmit = () => {
    setStep('select-providers');
    setProviderCursor(0);
  };

  // ── Provider selection handlers ────────────────────────────────────────

  const handleProviderToggle = (index: number) => {
    setProviderItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleProviderToggleAll = () => {
    const allSelected = providerItems.every((i) => i.selected);
    setProviderItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  };

  const handleProviderSubmit = () => {
    setStep('select-ignore');
    setIgnoreCursor(0);
  };

  const handleProviderBack = () => {
    setStep('select-env-files');
    setEnvFileCursor(0);
  };

  // ── Ignore key selection handlers ──────────────────────────────────────

  const handleIgnoreToggle = (index: number) => {
    setIgnoreItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleIgnoreToggleAll = () => {
    const allSelected = ignoreItems.every((i) => i.selected);
    setIgnoreItems((prev) => prev.map((item) => ({ ...item, selected: !allSelected })));
  };

  const handleIgnoreSubmit = () => {
    setStep('preview');
  };

  const handleIgnoreBack = () => {
    setStep('select-providers');
    setProviderCursor(0);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  const config = buildConfig();

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text> </Text>
      <Banner subtitle="config init" />
      <Text> </Text>

      {step === 'overwrite-confirm' && (
        <Box flexDirection="column">
          <Text color="yellow">{'⚠ .envguard.json already exists. Overwrite? (y/n)'}</Text>
        </Box>
      )}

      {step === 'select-env-files' && (
        <Box flexDirection="column">
          {envFileItems.length > 0 ? (
            <SelectList
              items={envFileItems}
              cursor={envFileCursor}
              onToggle={handleEnvFileToggle}
              onToggleAll={handleEnvFileToggleAll}
              onCursorChange={setEnvFileCursor}
              onSubmit={handleEnvFileSubmit}
              title="Select env files to track:"
            />
          ) : (
            <Box flexDirection="column">
              <Text dimColor>No .env files detected in project root.</Text>
              <Text dimColor>Press Enter to continue.</Text>
            </Box>
          )}
        </Box>
      )}

      {step === 'select-env-files' && envFileItems.length === 0 && (
        <NoEnvFilesHandler onSubmit={handleEnvFileSubmit} />
      )}

      {step === 'select-providers' && (
        <SelectList
          items={providerItems}
          cursor={providerCursor}
          onToggle={handleProviderToggle}
          onToggleAll={handleProviderToggleAll}
          onCursorChange={setProviderCursor}
          onSubmit={handleProviderSubmit}
          onBack={handleProviderBack}
          title="Select providers:"
        />
      )}

      {step === 'select-ignore' && (
        <SelectList
          items={ignoreItems}
          cursor={ignoreCursor}
          onToggle={handleIgnoreToggle}
          onToggleAll={handleIgnoreToggleAll}
          onCursorChange={setIgnoreCursor}
          onSubmit={handleIgnoreSubmit}
          onBack={handleIgnoreBack}
          title="Keys to ignore (common non-secret vars):"
        />
      )}

      {step === 'preview' && <PreviewView config={config} />}

      {step === 'done' && <DoneView writeError={writeError} />}
    </Box>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NoEnvFilesHandler({ onSubmit }: { onSubmit: () => void }) {
  useInput((_input, key) => {
    if (key.return) {
      onSubmit();
    }
  });

  return null;
}

function PreviewView({ config }: { config: Config }) {
  const json = JSON.stringify(config, null, 2);

  return (
    <Box flexDirection="column">
      <Text bold>Preview .envguard.json:</Text>
      <Text> </Text>
      <Text>{json}</Text>
      <Text> </Text>
      <Text dimColor>Press Enter to save, Escape to go back</Text>
    </Box>
  );
}

function DoneView({ writeError }: { writeError: string | null }) {
  if (writeError) {
    return (
      <Box flexDirection="column">
        <Text color="red">{`Error writing .envguard.json: ${writeError}`}</Text>
        <Text> </Text>
        <Text dimColor>Press Enter to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">{'✓'}</Text>
        {' .envguard.json created successfully'}
      </Text>
      <Text> </Text>
      <Text dimColor>Press Enter to exit</Text>
    </Box>
  );
}
