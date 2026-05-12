'use client';

import { useState } from 'react';
import { Bug, X, Check, Loader2 } from 'lucide-react';

interface RiftFeedbackButtonProps {
  basePrompt: string;
  imageDescription?: string;
  questionText: string;
  questionOptions?: string[];
  questionStep?: number;
  totalSteps?: number;
  targetGap?: string;
  riftVersion?: string;
}

const REASON_OPTIONS = [
  { value: 'already_specified', label: 'I already specified this in my prompt' },
  { value: 'wrong_question', label: 'Wrong question for my scene' },
  { value: 'too_many_questions', label: 'Asking too many questions' },
  { value: 'missing_question', label: 'Missing a question I needed' },
  { value: 'other', label: "Other (I'll describe below)" },
];

export default function RiftFeedbackButton({
  basePrompt,
  imageDescription,
  questionText,
  questionOptions,
  questionStep,
  totalSteps,
  targetGap,
  riftVersion = 'v3',
}: RiftFeedbackButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [suggestion, setSuggestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!selectedReason) {
      setError('Please select a reason');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/rift-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePrompt,
          imageDescription,
          questionText,
          questionOptions,
          questionStep,
          totalSteps,
          targetGap,
          reason: selectedReason,
          suggestedQuestion: suggestion.trim() || undefined,
          riftVersion,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit');
      }

      setSubmitted(true);
      setTimeout(() => {
        setIsOpen(false);
        setSubmitted(false);
        setSelectedReason('');
        setSuggestion('');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setIsOpen(false);
    setSelectedReason('');
    setSuggestion('');
    setError(null);
    setSubmitted(false);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-white/40 hover:text-white/80"
        aria-label="Report bad Rift question"
        title="Report this question"
      >
        <Bug className="w-3.5 h-3.5" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={handleClose}
        >
          <div
            className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {submitted ? (
              <div className="py-8 flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                  <Check className="w-7 h-7 text-green-400" />
                </div>
                <h3 className="text-white font-semibold text-lg mb-1">
                  Feedback received
                </h3>
                <p className="text-white/60 text-sm">
                  Thanks — this helps us make Rift smarter.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-semibold text-lg flex items-center gap-2">
                      <Bug className="w-4 h-4 text-orange-400" />
                      Report this question
                    </h3>
                    <p className="text-white/50 text-xs mt-1">
                      Help us make Rift smarter
                    </p>
                  </div>
                  <button
                    onClick={handleClose}
                    type="button"
                    className="text-white/40 hover:text-white/80 transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="mb-5 p-3 rounded-lg bg-white/5 border border-white/10">
                  <p className="text-white/50 text-xs uppercase tracking-wide mb-1">
                    Rift asked:
                  </p>
                  <p className="text-white/90 text-sm">{questionText}</p>
                </div>

                <div className="mb-5">
                  <p className="text-white/80 text-sm font-medium mb-2">
                    What&apos;s wrong with it?
                  </p>
                  <div className="space-y-2">
                    {REASON_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setSelectedReason(opt.value);
                          setError(null);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                          selectedReason === opt.value
                            ? 'bg-white/15 border border-white/30 text-white'
                            : 'bg-white/5 border border-white/10 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-5">
                  <label
                    htmlFor="rift-feedback-suggestion"
                    className="block text-white/80 text-sm font-medium mb-2"
                  >
                    What should Rift have asked?{' '}
                    <span className="text-white/40 font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="rift-feedback-suggestion"
                    value={suggestion}
                    onChange={(e) => setSuggestion(e.target.value)}
                    placeholder="e.g. Should have asked about the team's profession"
                    rows={3}
                    maxLength={500}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-white/30 text-sm resize-none focus:outline-none focus:border-white/30 transition-colors"
                  />
                  <p className="text-white/30 text-xs mt-1 text-right">
                    {suggestion.length} / 500
                  </p>
                </div>

                {error && (
                  <div className="mb-4 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleClose}
                    type="button"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    type="button"
                    disabled={isSubmitting || !selectedReason}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Submit feedback'
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}