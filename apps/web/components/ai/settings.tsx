'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { AiSettingsResponse } from '@saas/types';
import type { AiResult } from '@/lib/ai';
import { aiErrorText } from '@/lib/ai-errors';
import { saveAiSettings } from '@/app/(identity)/app/[organizationId]/ai/actions';
export function AiSettings({
  org,
  initial,
}: {
  org: string;
  initial: AiResult<AiSettingsResponse>;
}) {
  const [enabled, setEnabled] = useState(initial.ok ? initial.data.enabled : false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(initial.ok ? '' : aiErrorText(initial.code));
  return (
    <section className="panel ai-settings">
      <p className="eyebrow">ORGANIZATION / INTELLIGENCE</p>
      <h1>AI Settings</h1>
      <p>AI Copilot is {enabled ? 'enabled' : 'disabled'} for this organization.</p>
      <h2>Before enabling Copilot</h2>
      <p>
        Your questions, recent conversation and selected business metrics are sent to the external
        model provider configured by your administrator. Business names may be included when needed.
        Provider API usage may cost money.
      </p>
      <p>
        The model can make mistakes. Backend records remain the source of truth; Copilot can read
        permitted data and cannot change business records.
      </p>
      <p>
        Conversation text and source references are stored in this application. Users can delete
        their own conversations. This does not delete data already processed by the provider; its
        own retention terms apply.
      </p>
      {!enabled && (
        <label className="ai-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I understand this disclosure and authorize sharing permitted data with the configured
          provider for this organization.
        </label>
      )}
      <div className="ai-toolbar">
        <button
          className="button"
          disabled={busy || (!enabled && !consent) || !initial.ok}
          onClick={async () => {
            setBusy(true);
            setNotice('');
            try {
              const r = await saveAiSettings(org, !enabled);
              if (r.ok) {
                setEnabled(r.data.enabled);
                setConsent(false);
                setNotice('AI settings saved.');
              } else setNotice(aiErrorText(r.code));
            } catch {
              setNotice('Could not save settings. Please retry.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Saving…' : enabled ? 'Disable Copilot' : 'Enable Copilot'}
        </button>
        <Link href={`/app/${org}/ai`}>Open AI Copilot</Link>
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
