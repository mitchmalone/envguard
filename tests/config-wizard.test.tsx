import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSchema } from '../src/types.js';
import { ConfigWizard, type ConfigWizardResult } from '../src/ui/ConfigWizard.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const tick = () => new Promise<void>((r) => setTimeout(r, 30));

async function waitFor(fn: () => void, timeout = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      await tick();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  fn();
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'envguard-test-'));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ConfigWizard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows env file selection on start', async () => {
    const { lastFrame, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env', '.env.local']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('envguard');
      expect(frame).toContain('config init');
      expect(frame).toContain('Select env files to track:');
      expect(frame).toContain('.env');
      expect(frame).toContain('.env.local');
    });

    unmount();
  });

  it('shows overwrite confirmation when existing config exists', async () => {
    const { lastFrame, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        existingConfig={{ envFiles: ['.env'] }}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('already exists');
      expect(frame).toContain('Overwrite');
    });

    unmount();
  });

  it('cancels on n when overwrite confirmation shown', async () => {
    const onCancel = vi.fn();
    const { stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        existingConfig={{ envFiles: ['.env'] }}
        onComplete={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await tick();
    stdin.write('n');
    await tick();

    expect(onCancel).toHaveBeenCalled();
    unmount();
  });

  it('proceeds to env files on y when overwrite confirmation shown', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        existingConfig={{ envFiles: ['.env'] }}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Overwrite');
    });

    stdin.write('y');

    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files to track:');
    });

    unmount();
  });

  it('navigates from env files to providers', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files to track:');
    });

    stdin.write('\r'); // Enter → providers

    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
      expect(lastFrame()).toContain('github');
      expect(lastFrame()).toContain('vercel');
      expect(lastFrame()).toContain('netlify');
    });

    unmount();
  });

  it('shows detected hint on auto-detected providers', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github', 'vercel']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });

    stdin.write('\r'); // → providers

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('detected');
    });

    unmount();
  });

  it('navigates from providers to ignore keys', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // → env files
    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r'); // → providers

    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\r'); // → ignore

    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
      expect(lastFrame()).toContain('NODE_ENV');
      expect(lastFrame()).toContain('DEBUG');
      expect(lastFrame()).toContain('PORT');
    });

    unmount();
  });

  it('goes back from providers to env files on escape', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r'); // → providers

    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\u001B'); // Escape → back to env files

    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });

    unmount();
  });

  it('goes back from ignore to providers on escape', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r'); // → providers
    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\r'); // → ignore
    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
    });
    stdin.write('\u001B'); // Escape → back to providers

    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });

    unmount();
  });

  it('shows preview with generated config', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Navigate through: env files → providers → ignore → preview
    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r'); // → providers
    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\r'); // → ignore
    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
    });
    stdin.write('\r'); // → preview

    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Preview .envguard.json');
      expect(frame).toContain('envFiles');
      expect(frame).toContain('.env');
      expect(frame).toContain('github');
      expect(frame).toContain('Press Enter to save');
    });

    unmount();
  });

  it('goes back from preview to ignore on escape', async () => {
    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Navigate to preview
    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Preview');
    });

    stdin.write('\u001B'); // Escape → back to ignore

    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
    });

    unmount();
  });

  it('writes valid config file and shows done state', async () => {
    const tmpDir = makeTmpDir();
    const onComplete = vi.fn();

    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot={tmpDir}
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={onComplete}
        onCancel={vi.fn()}
      />,
    );

    // Navigate to preview
    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Preview');
    });

    stdin.write('\r'); // Enter → save

    await waitFor(() => {
      expect(lastFrame()).toContain('created successfully');
    });

    // Verify file was written
    const configPath = join(tmpDir, '.envguard.json');
    expect(existsSync(configPath)).toBe(true);

    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    const parsed = configSchema.safeParse(content);
    expect(parsed.success).toBe(true);
    expect(content.envFiles).toEqual(['.env']);
    expect(content.providers).toEqual(['github']);

    // Verify callback was called
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          envFiles: ['.env'],
          providers: ['github'],
        }),
        filePath: configPath,
      }),
    );

    // Cleanup
    try {
      unlinkSync(configPath);
    } catch {
      // ignore
    }

    unmount();
  });

  it('shows no env files message when none detected', async () => {
    const { lastFrame, unmount } = render(
      <ConfigWizard
        projectRoot="/tmp/fake"
        detectedEnvFiles={[]}
        detectedProviders={['github']}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('No .env files detected');
    });

    unmount();
  });

  it('includes ignore keys in generated config when selected', async () => {
    const tmpDir = makeTmpDir();
    const onComplete = vi.fn();

    const { lastFrame, stdin, unmount } = render(
      <ConfigWizard
        projectRoot={tmpDir}
        detectedEnvFiles={['.env']}
        detectedProviders={['github']}
        onComplete={onComplete}
        onCancel={vi.fn()}
      />,
    );

    // Navigate to ignore step
    await waitFor(() => {
      expect(lastFrame()).toContain('Select env files');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Select providers:');
    });
    stdin.write('\r');
    await waitFor(() => {
      expect(lastFrame()).toContain('Keys to ignore');
    });

    // Toggle NODE_ENV (first item, cursor is already on it)
    stdin.write(' ');
    await tick();

    stdin.write('\r'); // → preview
    await waitFor(() => {
      const frame = lastFrame();
      expect(frame).toContain('Preview');
      expect(frame).toContain('NODE_ENV');
    });

    stdin.write('\r'); // → save

    await waitFor(() => {
      expect(lastFrame()).toContain('created successfully');
    });

    const configPath = join(tmpDir, '.envguard.json');
    const content = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(content.ignore).toEqual(['NODE_ENV']);

    // Cleanup
    try {
      unlinkSync(configPath);
    } catch {
      // ignore
    }

    unmount();
  });
});
