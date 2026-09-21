import { formatWeight } from "@/lib/format";
export function WeightSummary({ rawWeightGrams, estimatedCleanedWeightGrams, cleaningLossPercent }: { rawWeightGrams: number; estimatedCleanedWeightGrams?: number; cleaningLossPercent?: number }) {
  return <div className="weight-summary">
    <dl><div><dt>Raw weight ordered</dt><dd>{formatWeight(rawWeightGrams)}</dd></div>
      {estimatedCleanedWeightGrams !== undefined && <div><dt>Estimated cleaned weight</dt><dd>~{formatWeight(estimatedCleanedWeightGrams)}</dd></div>}
    </dl>
    {estimatedCleanedWeightGrams !== undefined ? <p>Prices are based on raw weight. After cleaning, approximately {cleaningLossPercent}% of the weight may be reduced. The delivered weight is an estimate, not a guarantee.</p> : <p>Prices are based on raw weight.</p>}
  </div>;
}
