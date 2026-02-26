import { Box, Static, Text, useApp, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { CheckResult, ProviderName, PushResult, SecretEntry } from '../types.js';
import { Banner } from './components/Banner.js';
import { type SelectItem, SelectList } from './components/SelectList.js';
import { Spinner } from './components/Spinner.js';
import { maskValue } from './mask.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Step = 'loading' | 'select-secrets' | 'select-targets' | 'confirm' | 'pushing' | 'done';

interface TargetInfo {
  provider: ProviderName;
  target: string;
  displayName: string;
}

export interface PushLoadResult {
  checkResult: CheckResult;
  allTargets: TargetInfo[];
}

export interface PushWizardProps {
  loadData: () => Promise<PushLoadResult>;
  pushFn: (
    secrets: Record<string, string>,
    provider: ProviderName,
    target: string,
  ) => Promise<PushResult[]>;
  onExit: (code: number) => void;
  verbose?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTarget(provider: ProviderName, target: string): string {
  if (provider === 'github') {
    return `GitHub ${target.charAt(0).toUpperCase()}${target.slice(1)}`;
  }
  const names: Record<ProviderName, string> = {
    github: 'GitHub',
    vercel: 'Vercel',
    netlify: 'Netlify',
  };
  return `${names[provider] ?? provider} (${target})`;
}

interface SecretRowResult {
  key: string;
  targets: Array<{
    displayName: string;
    status: 'ok' | 'error';
    error?: string;
  }>;
  allOk: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PushWizard({ loadData, pushFn, onExit, verbose }: PushWizardProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);

  // Loading results
  const [loadResult, setLoadResult] = useState<PushLoadResult | null>(null);

  // Secret selection
  const [secretItems, setSecretItems] = useState<SelectItem[]>([]);
  const [secretCursor, setSecretCursor] = useState(0);

  // Target selection
  const [targetItems, setTargetItems] = useState<SelectItem[]>([]);
  const [targetCursor, setTargetCursor] = useState(0);

  // Push progress
  const [completedRows, setCompletedRows] = useState<SecretRowResult[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [summaryCode, setSummaryCode] = useState(0);

  // Store secret values for pushing
  const secretValuesRef = useRef<Record<string, string>>({});

  // ── Loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 'loading') return;

    loadData()
      .then((result) => {
        setLoadResult(result);

        // Build secret values map
        const values: Record<string, string> = {};
        for (const s of result.checkResult.localSecrets) {
          if (!(s.key in values)) {
            values[s.key] = s.value;
          }
        }
        secretValuesRef.current = values;

        // Build secret items
        const missingKeys = new Set(result.checkResult.missing.map((m) => m.key));
        const seen = new Set<string>();
        const items: SelectItem[] = [];
        for (const s of result.checkResult.localSecrets) {
          if (seen.has(s.key)) continue;
          seen.add(s.key);

          const isMissing = missingKeys.has(s.key);
          items.push({
            label: s.key,
            value: s.key,
            hint: isMissing ? `from ${s.source}` : 'already synced',
            selected: isMissing,
            disabled: false,
          });
        }
        setSecretItems(items);

        // Build target items (all pre-selected)
        const tItems: SelectItem[] = result.allTargets.map((t) => ({
          label: t.displayName,
          value: `${t.provider}:${t.target}`,
          selected: true,
        }));
        setTargetItems(tItems);

        setStep('select-secrets');
        setSecretCursor(0);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStep('done');
        setSummaryCode(2);
      });
  }, [step, loadData]);

  // ── Pushing ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (step !== 'pushing') return;
    if (!loadResult) return;

    const selectedKeys = secretItems.filter((i) => i.selected).map((i) => i.value);
    const selectedTargets = targetItems
      .filter((i) => i.selected)
      .map((i) => {
        const [provider, target] = i.value.split(':') as [ProviderName, string];
        return {
          provider,
          target,
          displayName: formatTarget(provider, target),
        };
      });

    const doPush = async () => {
      const rows: SecretRowResult[] = [];
      let hasErrors = false;

      for (const key of selectedKeys) {
        setCurrentKey(key);
        const secretMap = { [key]: secretValuesRef.current[key] };
        const targetResults: SecretRowResult['targets'] = [];

        for (const t of selectedTargets) {
          try {
            const results = await pushFn(secretMap, t.provider, t.target);
            const result = results[0];
            targetResults.push({
              displayName: t.displayName,
              status: result?.status ?? 'error',
              error: result?.error,
            });
            if (result?.status === 'error') hasErrors = true;
          } catch (err) {
            targetResults.push({
              displayName: t.displayName,
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            });
            hasErrors = true;
          }
        }

        const row: SecretRowResult = {
          key,
          targets: targetResults,
          allOk: targetResults.every((t) => t.status === 'ok'),
        };
        rows.push(row);
        setCompletedRows([...rows]);
      }

      setCurrentKey(null);
      setSummaryCode(hasErrors ? 1 : 0);
      setStep('done');
    };

    doPush().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setSummaryCode(2);
      setStep('done');
    });
  }, [step, loadResult, secretItems, targetItems, pushFn]);

  // ── Confirm / Done keyboard handling ───────────────────────────────────

  useInput(
    (input, key) => {
      if (step === 'confirm') {
        if (key.return) {
          setStep('pushing');
        } else if (key.escape) {
          setStep('select-targets');
          setTargetCursor(0);
        }
      } else if (step === 'done') {
        if (key.return || input === 'q') {
          onExit(summaryCode);
          exit();
        }
      }
    },
    { isActive: step === 'confirm' || step === 'done' },
  );

  // ── Secret selection handlers ──────────────────────────────────────────

  const handleSecretToggle = (index: number) => {
    setSecretItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleSecretToggleAll = () => {
    const allSelected = secretItems.filter((i) => !i.disabled).every((i) => i.selected);
    setSecretItems((prev) =>
      prev.map((item) => (item.disabled ? item : { ...item, selected: !allSelected })),
    );
  };

  const handleSecretSubmit = () => {
    const hasSelected = secretItems.some((i) => i.selected);
    if (hasSelected) {
      setStep('select-targets');
      setTargetCursor(0);
    }
  };

  // ── Target selection handlers ──────────────────────────────────────────

  const handleTargetToggle = (index: number) => {
    setTargetItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  };

  const handleTargetToggleAll = () => {
    const allSelected = targetItems.filter((i) => !i.disabled).every((i) => i.selected);
    setTargetItems((prev) =>
      prev.map((item) => (item.disabled ? item : { ...item, selected: !allSelected })),
    );
  };

  const handleTargetSubmit = () => {
    const hasSelected = targetItems.some((i) => i.selected);
    if (hasSelected) {
      setStep('confirm');
    }
  };

  const handleTargetBack = () => {
    setStep('select-secrets');
    setSecretCursor(0);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text> </Text>
      <Banner subtitle="push secrets" />
      <Text> </Text>

      {step === 'loading' && <Spinner label="Loading..." />}

      {step !== 'loading' && loadResult && (
        <LoadingSummary
          secrets={loadResult.checkResult.localSecrets}
          targets={loadResult.allTargets}
        />
      )}

      {step === 'select-secrets' && (
        <Box flexDirection="column">
          <Text> </Text>
          <SelectList
            items={secretItems}
            cursor={secretCursor}
            onToggle={handleSecretToggle}
            onToggleAll={handleSecretToggleAll}
            onCursorChange={setSecretCursor}
            onSubmit={handleSecretSubmit}
            title="Select secrets to push:"
          />
        </Box>
      )}

      {step === 'select-targets' && (
        <Box flexDirection="column">
          <Text> </Text>
          <SelectList
            items={targetItems}
            cursor={targetCursor}
            onToggle={handleTargetToggle}
            onToggleAll={handleTargetToggleAll}
            onCursorChange={setTargetCursor}
            onSubmit={handleTargetSubmit}
            onBack={handleTargetBack}
            title="Push to:"
          />
        </Box>
      )}

      {step === 'confirm' && (
        <ConfirmView
          secretItems={secretItems}
          targetItems={targetItems}
          verbose={verbose}
          secretValues={secretValuesRef.current}
        />
      )}

      {step === 'pushing' && <PushingView completedRows={completedRows} currentKey={currentKey} />}

      {step === 'done' && (
        <DoneView completedRows={completedRows} error={error} summaryCode={summaryCode} />
      )}
    </Box>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function LoadingSummary({
  secrets,
  targets,
}: {
  secrets: SecretEntry[];
  targets: TargetInfo[];
}) {
  const uniqueKeys = new Set(secrets.map((s) => s.key));
  const sources = [...new Set(secrets.map((s) => s.source))];

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">{'✓'}</Text>
        {` ${uniqueKeys.size} secret${uniqueKeys.size !== 1 ? 's' : ''} from ${sources.join(', ')}`}
      </Text>
      <Text>
        <Text color="green">{'✓'}</Text>
        {` Providers: ${targets.map((t) => t.displayName).join(', ')}`}
      </Text>
    </Box>
  );
}

function ConfirmView({
  secretItems,
  targetItems,
  verbose,
  secretValues,
}: {
  secretItems: SelectItem[];
  targetItems: SelectItem[];
  verbose?: boolean;
  secretValues: Record<string, string>;
}) {
  const selected = secretItems.filter((i) => i.selected);
  const selectedTargets = targetItems.filter((i) => i.selected);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text bold>
        {`Pushing ${selected.length} secret${selected.length !== 1 ? 's' : ''} to ${selectedTargets.length} target${selectedTargets.length !== 1 ? 's' : ''}:`}
      </Text>
      <Text> </Text>
      {selected.map((s) => (
        <Text key={s.value}>
          {`  ${s.label}`}
          {verbose ? <Text dimColor>{` = ${maskValue(secretValues[s.value] ?? '')}`}</Text> : null}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>
        {'  → '}
        {selectedTargets.map((t) => t.label).join(', ')}
      </Text>
      <Text> </Text>
      <Text dimColor>Press Enter to push, Escape to go back</Text>
    </Box>
  );
}

function PushingView({
  completedRows,
  currentKey,
}: {
  completedRows: SecretRowResult[];
  currentKey: string | null;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Static items={completedRows}>{(row) => <PushRow key={row.key} row={row} />}</Static>
      {currentKey ? (
        <Text>
          <Text color="cyan">{'⠋'}</Text>
          {` ${currentKey}`}
        </Text>
      ) : null}
    </Box>
  );
}

function PushRow({ row }: { row: SecretRowResult }) {
  const icon = row.allOk ? <Text color="green">{'✓'}</Text> : <Text color="red">{'✗'}</Text>;
  const targetStrs = row.targets
    .map((t) => {
      const tIcon = t.status === 'ok' ? '✓' : '✗';
      const errorSuffix = t.status === 'error' && t.error ? ` (${t.error})` : '';
      return `${t.displayName} ${tIcon}${errorSuffix}`;
    })
    .join('  ');

  return (
    <Text>
      {icon}
      {` ${row.key.padEnd(20)} → ${targetStrs}`}
    </Text>
  );
}

function DoneView({
  completedRows,
  error,
  summaryCode,
}: {
  completedRows: SecretRowResult[];
  error: string | null;
  summaryCode: number;
}) {
  if (error) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text color="red">{`Error: ${error}`}</Text>
        <Text> </Text>
        <Text dimColor>Press Enter to exit</Text>
      </Box>
    );
  }

  const totalSecrets = completedRows.length;
  const fullySynced = completedRows.filter((r) => r.allOk).length;
  const partial = totalSecrets - fullySynced;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {fullySynced > 0 && (
        <Text>
          <Text color="green">{'✓'}</Text>
          {` ${fullySynced} secret${fullySynced !== 1 ? 's' : ''} fully synced`}
        </Text>
      )}
      {partial > 0 && (
        <Text>
          <Text color="yellow">{'⚠'}</Text>
          {` ${partial} secret${partial !== 1 ? 's' : ''} had errors`}
        </Text>
      )}
      {totalSecrets === 0 && <Text dimColor>No secrets were pushed.</Text>}
      <Text> </Text>
      <Text dimColor>Press Enter to exit</Text>
    </Box>
  );
}
