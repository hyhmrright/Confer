import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Key, Shield, User } from './Icons.js';
import { PermissionHistory } from './PermissionHistory.js';
import { AgentTab } from './settings/AgentTab.js';
import { KeysTab } from './settings/KeysTab.js';
import { PolicyTab } from './settings/PolicyTab.js';
import { ProfileTab } from './settings/ProfileTab.js';
import { type PageTab, TabbedPage } from './TabbedPage.js';

type Tab = 'profile' | 'agent' | 'keys' | 'policy' | 'history';

export function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('profile');

  const tabs: PageTab<Tab>[] = [
    { id: 'profile', label: t('settings.tabProfile'), icon: User },
    { id: 'agent', label: t('settings.tabAgent'), icon: Bot },
    { id: 'keys', label: t('settings.tabKeys'), icon: Key },
    { id: 'policy', label: t('settings.tabPolicy'), icon: Shield },
    { id: 'history', label: t('settings.tabHistory'), icon: Shield },
  ];

  return (
    <TabbedPage
      title={t('settings.title')}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      contentClassName="max-w-lg"
    >
      {tab === 'profile' && <ProfileTab />}
      {tab === 'agent' && <AgentTab />}
      {tab === 'keys' && <KeysTab />}
      {tab === 'policy' && <PolicyTab />}
      {tab === 'history' && <PermissionHistory />}
    </TabbedPage>
  );
}
