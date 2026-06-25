import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
}

const SearchBar = ({ value, onChange }: SearchBarProps) => (
  <div className="relative">
    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      placeholder="Search area, clinic, doctor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 rounded-2xl bg-card pl-9 shadow-sm"
    />
  </div>
);

export default SearchBar;
