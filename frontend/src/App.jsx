import { useState } from "react";
import IndustryList from "./components/IndustryList";
import IndustryDetail from "./components/IndustryDetail";

export default function App() {
  const [selectedIndustry, setSelectedIndustry] = useState(null);

  return (
    <div className="min-h-screen bg-white">
      {selectedIndustry ? (
        <IndustryDetail
          industryName={selectedIndustry}
          onBack={() => setSelectedIndustry(null)}
        />
      ) : (
        <IndustryList onSelectIndustry={setSelectedIndustry} />
      )}

      <footer className="pb-6 text-center text-xs text-gray-400">
        Market data provided by{" "}
        <a
          href="https://site.financialmodelingprep.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          Financial Modeling Prep
        </a>
      </footer>
    </div>
  );
}
