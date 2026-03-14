import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { FeedbackType } from '../../types';
import { useToast } from '../shared/Toast';

interface UserAssessmentProps {
  trendId: string;
}

const voteOptions: { value: FeedbackType; label: string }[] = [
  { value: 'gold', label: 'Gold' },
  { value: 'good_wrong_timing', label: 'Good, wrong timing' },
  { value: 'wrong_brand', label: 'Wrong brand' },
  { value: 'trash', label: 'Not relevant' },
];

export function UserAssessment({ trendId }: UserAssessmentProps) {
  const [selectedVote, setSelectedVote] = useState<FeedbackType | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const handleSubmit = async () => {
    if (!selectedVote) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('team_feedback').insert({
        trend_id: trendId,
        vote: selectedVote,
        notes: note || null,
        voted_by: 'team',
        client_name: 'general',
        feedback: selectedVote,
      });

      if (error) throw error;
      toast.show('Feedback saved', 'success');
      setSelectedVote(null);
      setNote('');
    } catch {
      toast.show('Failed to save feedback', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
        Your Assessment
      </h3>
      <div className="flex flex-wrap gap-2 mb-3">
        {voteOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSelectedVote(selectedVote === opt.value ? null : opt.value)}
            className="px-3 py-1.5 rounded-md text-[12px] transition-colors"
            style={{
              background: selectedVote === opt.value ? 'var(--bg-input)' : 'transparent',
              border: `1px solid ${selectedVote === opt.value ? 'var(--text-muted)' : 'var(--border-card)'}`,
              color: selectedVote === opt.value ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {selectedVote && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none mb-2"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-input)',
              color: 'var(--text-body)',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium disabled:opacity-50"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
              color: 'var(--text-primary)',
            }}
          >
            {submitting ? 'Saving...' : 'Submit'}
          </button>
        </>
      )}
    </div>
  );
}
