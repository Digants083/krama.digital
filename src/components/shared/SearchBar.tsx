import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
}

const SearchBar = ({ value, onChange }: SearchBarProps) => (
  <div className="relative">
    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
    <Input
      placeholder="Search area, clinic, doctor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-12 rounded-2xl border-white/70 bg-white/85 pl-11 font-semibold shadow-[0_16px_44px_-34px_rgba(19,55,50,0.7)] backdrop-blur placeholder:text-muted-foreground focus-visible:ring-primary/20"
    />
  </div>
);

export default SearchBar;
