interface Props {
  isCorrect: boolean;
  explanation: string;
}

export function QuizExplanation({ isCorrect, explanation }: Props) {
  return (
    <div
      className={[
        'rounded-[10px] border px-4 py-3',
        isCorrect
          ? 'border-success/40 bg-success/5'
          : 'border-danger/40 bg-danger/5',
      ].join(' ')}
    >
      <p
        className={[
          'mb-2 font-sans text-sm font-semibold',
          isCorrect ? 'text-success' : 'text-danger',
        ].join(' ')}
      >
        {isCorrect ? '✓ Resposta correta' : '✗ Resposta errada'}
      </p>
      <p className="font-sans text-sm leading-relaxed text-text">{explanation}</p>
    </div>
  );
}
