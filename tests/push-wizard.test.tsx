import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult, ProviderName, PushResult } from '../src/types.js';
import { type PushLoadResult, PushWizard } from '../src/ui/PushWizard.js';
import { Banner } from '../src/ui/components/Banner.js';
import { SelectList } from '../src/ui/components/SelectList.js';
import { Spinner } from '../src/ui/components/Spinner.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const tick = () => new Promise<void>((r) => setTimeout(r, 30));

async function waitFor(fn: () => void, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      // Give effects time to settle after assertion passes
      await tick();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  fn(); // Final call — will throw if still failing
}

// ── Spinner tests ──────────────────────────────────────────────────────────

describe('Spinner', () => {
  it('renders with a label', () => {
    const { lastFrame, unmount } = render(<Spinner label="Loading..." />);
    const frame = lastFrame();
    expect(frame).toContain('Loading...');
    unmount();
  });

  it('renders without a label', () => {
    const { lastFrame, unmount } = render(<Spinner />);
    const frame = lastFrame();
    expect(frame).toBeTruthy();
    unmount();
  });
});

// ── Banner tests ───────────────────────────────────────────────────────────

describe('Banner', () => {
  it('renders with subtitle', () => {
    const { lastFrame, unmount } = render(<Banner subtitle="push secrets" />);
    const frame = lastFrame();
    expect(frame).toContain('envguard');
    expect(frame).toContain('push secrets');
    unmount();
  });

  it('renders without subtitle', () => {
    const { lastFrame, unmount } = render(<Banner />);
    const frame = lastFrame();
    expect(frame).toContain('envguard');
    unmount();
  });
});

// ── SelectList tests ───────────────────────────────────────────────────────

describe('SelectList', () => {
  it('renders items with checkboxes', () => {
    const { lastFrame, unmount } = render(
      <SelectList
        items={[
          { label: 'Item A', value: 'a', selected: true },
          { label: 'Item B', value: 'b', selected: false },
          {
            label: 'Item C',
            value: 'c',
            selected: false,
            disabled: true,
            hint: 'unavailable',
          },
        ]}
        cursor={0}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onCursorChange={vi.fn()}
        onSubmit={vi.fn()}
        title="Select items:"
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain('Select items:');
    expect(frame).toContain('Item A');
    expect(frame).toContain('Item B');
    expect(frame).toContain('Item C');
    expect(frame).toContain('unavailable');
    unmount();
  });

  it('calls onCursorChange on arrow down', async () => {
    const onCursorChange = vi.fn();

    const { stdin, unmount } = render(
      <SelectList
        items={[
          { label: 'A', value: 'a', selected: false },
          { label: 'B', value: 'b', selected: false },
        ]}
        cursor={0}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onCursorChange={onCursorChange}
        onSubmit={vi.fn()}
      />,
    );

    await tick(); // Wait for useEffect (useInput registration)
    stdin.write('\u001B[B'); // Arrow down
    await tick();
    expect(onCursorChange).toHaveBeenCalledWith(1);
    unmount();
  });

  it('calls onToggle on space', async () => {
    const onToggle = vi.fn();

    const { stdin, unmount } = render(
      <SelectList
        items={[
          { label: 'A', value: 'a', selected: false },
          { label: 'B', value: 'b', selected: false },
        ]}
        cursor={0}
        onToggle={onToggle}
        onToggleAll={vi.fn()}
        onCursorChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await tick();
    stdin.write(' ');
    await tick();
    expect(onToggle).toHaveBeenCalledWith(0);
    unmount();
  });

  it('calls onSubmit on enter', async () => {
    const onSubmit = vi.fn();

    const { stdin, unmount } = render(
      <SelectList
        items={[{ label: 'A', value: 'a', selected: true }]}
        cursor={0}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onCursorChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await tick();
    stdin.write('\r');
    await tick();
    expect(onSubmit).toHaveBeenCalled();
    unmount();
  });

  it("calls onToggleAll on 'a' key", async () => {
    const onToggleAll = vi.fn();

    const { stdin, unmount } = render(
      <SelectList
        items={[{ label: 'A', value: 'a', selected: false }]}
        cursor={0}
        onToggle={vi.fn()}
        onToggleAll={onToggleAll}
        onCursorChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    await tick();
    stdin.write('a');
    await tick();
    expect(onToggleAll).toHaveBeenCalled();
    unmount();
  });

  it('calls onBack on escape', async () => {
    const onBack = vi.fn();

    const { stdin, unmount } = render(
      <SelectList
        items={[{ label: 'A', value: 'a', selected: false }]}
        cursor={0}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onCursorChange={vi.fn()}
        onSubmit={vi.fn()}
        onBack={onBack}
      />,
    );

    await tick();
    stdin.write('\u001B');
    await tick();
    expect(onBack).toHaveBeenCalled();
    unmount();
  });

  it('wraps cursor from bottom to top on arrow up', async () => {
    const onCursorChange = vi.fn();

    const { stdin, unmount } = render(
      <SelectList
        items={[
          { label: 'A', value: 'a', selected: false },
          { label: 'B', value: 'b', selected: false },
        ]}
        cursor={0}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onCursorChange={onCursorChange}
        onSubmit={vi.fn()}
      />,
    );

    await tick();
    stdin.write('\u001B[A'); // Arrow up at position 0
    await tick();
    expect(onCursorChange).toHaveBeenCalledWith(1); // Wraps to last
    unmount();
  });
});

// ── PushWizard tests ───────────────────────────────────────────────────────

describe('PushWizard', () => {
  const mockCheckResult: CheckResult = {
    localSecrets: [
      { key: 'API_KEY', value: 'abc123', source: '.env.local' },
      { key: 'STRIPE_KEY', value: 'sk_live_test', source: '.env.local' },
      { key: 'DB_URL', value: 'pg://localhost', source: '.env.local' },
    ],
    remoteKeys: [
      {
        provider: 'github',
        target: 'actions',
        keys: ['API_KEY'],
      },
    ],
    providers: [{ provider: 'github', displayName: 'GitHub', available: true }],
    missing: [
      {
        key: 'STRIPE_KEY',
        source: '.env.local',
        missingFrom: [{ provider: 'github', target: 'actions' }],
      },
      {
        key: 'DB_URL',
        source: '.env.local',
        missingFrom: [{ provider: 'github', target: 'actions' }],
      },
    ],
    duplicateKeys: [],
    allSynced: false,
  };

  const mockLoadResult: PushLoadResult = {
    checkResult: mockCheckResult,
    allTargets: [
      {
        provider: 'github',
        target: 'actions',
        displayName: 'GitHub Actions',
      },
      {
        provider: 'github',
        target: 'codespaces',
        displayName: 'GitHub Codespaces',
      },
    ],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    const loadData = vi.fn().mockReturnValue(new Promise(() => {})); // Never resolves
    const { lastFrame, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    const frame = lastFrame();
    expect(frame).toContain('envguard');
    expect(frame).toContain('push secrets');
    expect(frame).toContain('Loading...');
    unmount();
  });

  it('shows secret selection after loading', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Select secrets to push:');
      expect(frame).toContain('API_KEY');
      expect(frame).toContain('STRIPE_KEY');
      expect(frame).toContain('DB_URL');
    });

    unmount();
  });

  it('shows loading summary after load completes', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('3 secrets from .env.local');
      expect(frame).toContain('Providers:');
    });

    unmount();
  });

  it('navigates to target selection on enter', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to push:');
    });

    stdin.write('\r'); // Enter

    await waitFor(() => {
      expect(lastFrame()).toContain('Push to:');
      expect(lastFrame()).toContain('GitHub Actions');
      expect(lastFrame()).toContain('GitHub Codespaces');
    });

    unmount();
  });

  it('navigates to confirm on enter from targets', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to push:');
    });

    stdin.write('\r'); // Enter → targets

    await waitFor(() => {
      expect(lastFrame()).toContain('Push to:');
    });

    stdin.write('\r'); // Enter → confirm

    await waitFor(() => {
      expect(lastFrame()).toContain('Pushing');
      expect(lastFrame()).toContain('Press Enter to push');
    });

    unmount();
  });

  it('goes back to secrets from targets on escape', async () => {
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);
    const { lastFrame, stdin, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to push:');
    });

    stdin.write('\r'); // Enter → targets

    await waitFor(() => {
      expect(lastFrame()).toContain('Push to:');
    });

    stdin.write('\u001B'); // Escape → back to secrets

    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to push:');
    });

    unmount();
  });

  it('shows done state after pushing', async () => {
    const pushFn = vi.fn().mockResolvedValue([
      {
        key: 'STRIPE_KEY',
        provider: 'github',
        target: 'actions',
        status: 'ok',
      },
    ]);
    const onExit = vi.fn();
    const loadData = vi.fn().mockResolvedValue(mockLoadResult);

    const { lastFrame, stdin, unmount } = render(
      <PushWizard loadData={loadData} pushFn={pushFn} onExit={onExit} />,
    );

    // Navigate through: secrets → targets → confirm → push
    await waitFor(() => {
      expect(lastFrame()).toContain('Select secrets to push:');
    });
    stdin.write('\r'); // → targets

    await waitFor(() => {
      expect(lastFrame()).toContain('Push to:');
    });
    stdin.write('\r'); // → confirm

    await waitFor(() => {
      expect(lastFrame()).toContain('Press Enter to push');
    });
    stdin.write('\r'); // → push

    // Wait for done
    await waitFor(() => {
      expect(lastFrame()).toContain('synced');
    });

    unmount();
  });

  it('handles load error gracefully', async () => {
    const loadData = vi.fn().mockRejectedValue(new Error('Network failure'));

    const { lastFrame, unmount } = render(
      <PushWizard loadData={loadData} pushFn={vi.fn()} onExit={vi.fn()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Network failure');
    });

    unmount();
  });
});
