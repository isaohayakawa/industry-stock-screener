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
    </div>
  );
}
