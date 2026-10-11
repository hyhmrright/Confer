import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.js';
import { errorCode, errorStatus } from '../../lib/error.js';
import { secondFactorFields } from '../../lib/second-factor.js';
import { DISABLED_FILLED, FOCUS_RING, INPUT_FIELD_CLS } from '../../lib/styles.js';
import { LoadingDots } from '../LoadingDots.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

const SECONDARY_BTN = `px-3 py-1.5 rounded-lg border border-dark-border text-xs text-ink-secondary hover:bg-dark-hover hover:text-ink-primary ${FOCUS_RING}`;
const PRIMARY_BTN = `px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs hover:bg-primary-500 ${DISABLED_FILLED} ${FOCUS_RING}`;

/**
 * The sentence for a failed credential check: a wrong password or code (401),
 * the per-account lock on wrong codes (429), or anything else.
 */
function failureText(
  e: unknown,
  wrong: string,
  t: (key: 'login.totpLocked' | 'security.failed') => string,
) {
  if (errorStatus(e) === 401) return wrong;
  if (errorCode(e) === 'too_many_attempts') return t('login.totpLocked');
  return t('security.failed');
}

interface TwoFactorStatus {
  enabled: boolean;
  recovery_codes_left: number;
}

export function SecurityTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<TwoFactorStatus>('/auth/2fa')
      .then(setStatus)
      .catch(() => setError(t('security.failed')));

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  if (!status) return error ? <StatusMsg error={error} success={null} /> : <LoadingDots />;

  return (
    <div className="space-y-10">
      <ChangePassword twoFactorOn={status.enabled} />
      <TwoStepSignIn status={status} reload={load} />
    </div>
  );
}

function ChangePassword({ twoFactorOn }: { twoFactorOn: boolean }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post('/auth/password', {
        current_password: current,
        new_password: next,
        ...(twoFactorOn ? secondFactorFields(code) : {}),
      });
      setCurrent('');
      setNext('');
      setCode('');
      setSuccess(t('security.passwordChanged'));
    } catch (err) {
      setError(failureText(err, t('security.wrongPassword'), t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className="text-sm font-semibold text-ink-primary">{t('security.passwordHeading')}</h3>
      <div>
        <FieldLabel htmlFor="security-current">{t('security.currentPassword')}</FieldLabel>
        <input
          id="security-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={INPUT_FIELD_CLS}
          required
        />
      </div>
      <div>
        <FieldLabel htmlFor="security-new">{t('security.newPassword')}</FieldLabel>
        <input
          id="security-new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={INPUT_FIELD_CLS}
          minLength={8}
          maxLength={128}
          required
        />
        <p className="text-xs text-ink-muted mt-1.5">{t('security.newPasswordHint')}</p>
      </div>
      {twoFactorOn && (
        <div>
          <FieldLabel htmlFor="security-password-code">{t('security.codeOrRecovery')}</FieldLabel>
          <input
            id="security-password-code"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={INPUT_FIELD_CLS}
            required
          />
        </div>
      )}
      <StatusMsg error={error} success={success} />
      <button type="submit" disabled={saving} className={PRIMARY_BTN}>
        {saving ? t('common.saving') : t('security.changePassword')}
      </button>
    </form>
  );
}

// Off → (setup: scan, confirm) → recovery codes shown once → on → (turn off).
function TwoStepSignIn({ status, reload }: { status: TwoFactorStatus; reload: () => void }) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    try {
      const data = await api.post<{ secret: string; otpauth_uri: string }>('/auth/2fa/setup', {});
      setSetup({ secret: data.secret, uri: data.otpauth_uri });
    } catch {
      setError(t('security.failed'));
    }
  };

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-ink-primary">{t('security.twoFactorHeading')}</h3>

      {recoveryCodes ? (
        <RecoveryCodes
          codes={recoveryCodes}
          onDone={() => {
            setRecoveryCodes(null);
            reload();
          }}
        />
      ) : setup ? (
        <ConfirmSetup
          setup={setup}
          onCancel={() => setSetup(null)}
          onEnabled={(codes) => {
            setSetup(null);
            setRecoveryCodes(codes);
          }}
        />
      ) : status.enabled ? (
        <>
          <p className="text-xs text-ink-secondary">
            {t('security.twoFactorOn')}{' '}
            {t('security.recoveryLeft', { count: status.recovery_codes_left })}
          </p>
          <TurnOff onDone={reload} />
        </>
      ) : (
        <>
          <p className="text-xs text-ink-secondary">{t('security.twoFactorOff')}</p>
          <button type="button" onClick={start} className={PRIMARY_BTN}>
            {t('security.turnOn')}
          </button>
        </>
      )}
      <StatusMsg error={error} success={null} />
    </section>
  );
}

function ConfirmSetup({
  setup,
  onCancel,
  onEnabled,
}: {
  setup: { secret: string; uri: string };
  onCancel: () => void;
  onEnabled: (codes: string[]) => void;
}) {
  const { t } = useTranslation();
  const [qr, setQr] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loaded here and only here: nobody else in the app draws a QR code.
  useEffect(() => {
    let live = true;
    import('qrcode-generator').then(({ default: qrcode }) => {
      const code = qrcode(0, 'M');
      code.addData(setup.uri);
      code.make();
      if (live) setQr(code.createDataURL(4, 2));
    });
    return () => {
      live = false;
    };
  }, [setup.uri]);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ recovery_codes: string[] }>('/auth/2fa/enable', {
        password,
        code,
      });
      onEnabled(data.recovery_codes);
    } catch (err) {
      setError(failureText(err, t('security.wrongCode'), t));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={confirm} className="space-y-4">
      <p className="text-xs text-ink-secondary">{t('security.scanHint')}</p>
      {qr && (
        <img
          src={qr}
          alt=""
          className="w-40 h-40 rounded-lg bg-white p-1 [image-rendering:pixelated]"
        />
      )}
      <div>
        <FieldLabel>{t('security.secretKey')}</FieldLabel>
        <code className="block text-xs font-mono text-ink-primary break-all select-all">
          {setup.secret}
        </code>
      </div>
      <div>
        <FieldLabel htmlFor="security-setup-password">{t('security.password')}</FieldLabel>
        <input
          id="security-setup-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_FIELD_CLS}
          required
        />
      </div>
      <div>
        <FieldLabel htmlFor="security-setup-code">{t('security.code')}</FieldLabel>
        <input
          id="security-setup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={INPUT_FIELD_CLS}
          maxLength={8}
          required
        />
      </div>
      <StatusMsg error={error} success={null} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={PRIMARY_BTN}>
          {t('security.confirm')}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
          {t('security.cancel')}
        </button>
      </div>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      .writeText(codes.join('\n'))
      .then(() => setCopied(true))
      .catch(() => {});

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold text-ink-primary">{t('security.recoveryHeading')}</h4>
      <p className="text-xs text-ink-secondary">{t('security.recoveryHint')}</p>
      <ul className="grid grid-cols-2 gap-1.5 p-3 rounded-lg bg-dark-input border border-dark-border font-mono text-xs text-ink-primary">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className={SECONDARY_BTN}>
          {copied ? t('security.copied') : t('security.copyCodes')}
        </button>
        <button type="button" onClick={onDone} className={PRIMARY_BTN}>
          {t('security.done')}
        </button>
      </div>
    </div>
  );
}

function TurnOff({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/2fa/disable', { password, ...secondFactorFields(code) });
      onDone();
    } catch (err) {
      setError(failureText(err, t('security.wrongCode'), t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 pt-2">
      <p className="text-xs text-ink-muted">{t('security.turnOffHint')}</p>
      <div>
        <FieldLabel htmlFor="security-off-password">{t('security.password')}</FieldLabel>
        <input
          id="security-off-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_FIELD_CLS}
          required
        />
      </div>
      <div>
        <FieldLabel htmlFor="security-off-code">{t('security.codeOrRecovery')}</FieldLabel>
        <input
          id="security-off-code"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={INPUT_FIELD_CLS}
          required
        />
      </div>
      <StatusMsg error={error} success={null} />
      <button type="submit" disabled={busy} className={SECONDARY_BTN}>
        {t('security.turnOff')}
      </button>
    </form>
  );
}
