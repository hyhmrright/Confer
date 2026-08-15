import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.js';
import { captureError } from '../../lib/error.js';
import { INPUT_FIELD_CLS } from '../../lib/styles.js';
import { useAuthStore } from '../../stores/auth.js';
import { LanguageSwitcher } from '../LanguageSwitcher.js';
import { SaveButton } from '../SaveButton.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

export function ProfileTab() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.display_name ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
  }, [user]);

  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [success, error]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.patch('/users/me', {
        display_name: displayName || null,
        email: email || null,
        phone: phone || null,
      });
      await refreshUser();
      setSuccess(t('settings.saveSuccess'));
    } catch (e) {
      setError(captureError(e, t('settings.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="profile-username">{t('settings.profileUsername')}</FieldLabel>
        <input
          id="profile-username"
          type="text"
          value={user?.username ?? ''}
          disabled
          className="w-full px-3 py-2 bg-dark-base border border-dark-border rounded-lg text-sm text-ink-muted font-mono opacity-60"
        />
        <p className="text-[11px] text-ink-muted mt-1">{t('settings.profileUsernameHint')}</p>
      </div>
      <div>
        <FieldLabel htmlFor="profile-did">{t('settings.profileDid')}</FieldLabel>
        <input
          id="profile-did"
          type="text"
          value={user?.did ?? ''}
          disabled
          className="w-full px-3 py-2 bg-dark-base border border-dark-border rounded-lg text-xs text-ink-muted font-mono opacity-60"
        />
        <p className="text-[11px] text-ink-muted mt-1">{t('settings.profileDidHint')}</p>
      </div>
      <div>
        <FieldLabel htmlFor="profile-display-name">{t('settings.profileDisplayName')}</FieldLabel>
        <input
          id="profile-display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('settings.profileDisplayNamePlaceholder')}
          className={INPUT_FIELD_CLS}
        />
      </div>
      <div>
        <FieldLabel htmlFor="profile-email">{t('settings.profileEmail')}</FieldLabel>
        <input
          id="profile-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('settings.profileEmailPlaceholder')}
          className={INPUT_FIELD_CLS}
        />
      </div>
      <div>
        <FieldLabel htmlFor="profile-phone">{t('settings.profilePhone')}</FieldLabel>
        <input
          id="profile-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('settings.profilePhonePlaceholder')}
          className={INPUT_FIELD_CLS}
        />
      </div>

      <div>
        <FieldLabel htmlFor="profile-language">{t('language.label')}</FieldLabel>
        <LanguageSwitcher id="profile-language" />
      </div>

      <StatusMsg error={error} success={success} />

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}
