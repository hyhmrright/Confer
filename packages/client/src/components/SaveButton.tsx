import { useTranslation } from 'react-i18next';
import { DISABLED_FILLED } from '../lib/styles.js';

// Primary "save" action shared by the settings tabs and the contact policy
// editor. `label` overrides the default idle text; the saving text is always
// the shared one.
export function SaveButton({
  onClick,
  saving,
  label,
}: {
  onClick: () => void;
  saving: boolean;
  label?: string;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={`px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 ${DISABLED_FILLED} transition-colors`}
    >
      {saving ? t('common.saving') : (label ?? t('common.save'))}
    </button>
  );
}
