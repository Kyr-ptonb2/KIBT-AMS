import { useStore } from "../store";

export default function FYSelector() {
  const { selectedFY, setSelectedFY, financialYears } = useStore();

  return (
    <div>
      <label className="block text-white/50 text-xs mb-1 font-medium tracking-wide uppercase">
        Financial Year
      </label>
      <select
        value={selectedFY}
        onChange={(e) => setSelectedFY(e.target.value)}
        className="w-full bg-white/10 text-white text-sm px-2.5 py-2 rounded-lg border border-white/20 focus:outline-none focus:border-white/40 cursor-pointer"
      >
        {financialYears.map((fy) => (
          <option key={fy} value={fy} className="bg-kibt-green-dark text-white">
            FY {fy}
          </option>
        ))}
      </select>
    </div>
  );
}
