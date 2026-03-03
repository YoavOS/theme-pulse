import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, Plus, Trash2, Loader2, LogOut, ChevronDown, ChevronRight, Search,
} from "lucide-react";

interface Theme {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

interface ThemeTicker {
  id: string;
  theme_id: string;
  ticker_symbol: string;
  added_at: string;
}

export default function Admin() {
  const { user, isLoading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [themes, setThemes] = useState<Theme[]>([]);
  const [tickers, setTickers] = useState<ThemeTicker[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTheme, setExpandedTheme] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // New theme form
  const [newThemeName, setNewThemeName] = useState("");
  const [newThemeDesc, setNewThemeDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Add ticker form per theme
  const [tickerInput, setTickerInput] = useState<Record<string, string>>({});
  const [addingTicker, setAddingTicker] = useState<string | null>(null);

  // Smart add (no theme specified)
  const [smartTickerInput, setSmartTickerInput] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{ symbol: string; theme: string; themeId: string } | null>(null);

  // Edit theme
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [authLoading, user, navigate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: tk }] = await Promise.all([
      supabase.from("themes").select("*").order("name"),
      supabase.from("theme_tickers").select("*"),
    ]);
    setThemes((t as Theme[]) || []);
    setTickers((tk as ThemeTicker[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  const createTheme = async () => {
    const name = newThemeName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("themes")
      .insert({ name, description: newThemeDesc.trim() || null })
      .select()
      .single();
    setCreating(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Theme Created", description: `"${name}" is ready. Now add tickers!` });
      setNewThemeName("");
      setNewThemeDesc("");
      setThemes((prev) => [...prev, data as Theme].sort((a, b) => a.name.localeCompare(b.name)));
      setExpandedTheme((data as Theme).id);
    }
  };

  const deleteTheme = async (id: string, name: string) => {
    if (!confirm(`Delete theme "${name}" and all its tickers?`)) return;
    const { error } = await supabase.from("themes").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setThemes((prev) => prev.filter((t) => t.id !== id));
      setTickers((prev) => prev.filter((t) => t.theme_id !== id));
      toast({ title: "Deleted", description: `"${name}" removed.` });
    }
  };

  const updateTheme = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    const { error } = await supabase
      .from("themes")
      .update({ name, description: editDesc.trim() || null })
      .eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setThemes((prev) =>
        prev.map((t) => (t.id === id ? { ...t, name, description: editDesc.trim() || null } : t))
      );
      setEditingTheme(null);
      toast({ title: "Updated" });
    }
  };

  const addTickers = async (themeId: string, input: string) => {
    const symbols = input
      .toUpperCase()
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Z]{1,10}$/.test(s));
    if (symbols.length === 0) return;

    setAddingTicker(themeId);
    const inserts = symbols.map((s) => ({ theme_id: themeId, ticker_symbol: s }));
    const { data, error } = await supabase
      .from("theme_tickers")
      .insert(inserts)
      .select();
    setAddingTicker(null);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setTickers((prev) => [...prev, ...((data as ThemeTicker[]) || [])]);
      setTickerInput((prev) => ({ ...prev, [themeId]: "" }));
      toast({ title: "Added", description: `${symbols.length} ticker(s) added.` });
    }
  };

  const deleteTicker = async (tickerId: string, symbol: string) => {
    const { error } = await supabase.from("theme_tickers").delete().eq("id", tickerId);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setTickers((prev) => prev.filter((t) => t.id !== tickerId));
    }
  };

  const suggestTheme = async () => {
    const symbol = smartTickerInput.trim().toUpperCase();
    if (!symbol || !/^[A-Z]{1,10}$/.test(symbol)) return;
    setSuggesting(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/suggest-theme?symbol=${symbol}`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      const data = await res.json();

      if (data.theme_name && data.theme_id) {
        setSuggestion({ symbol, theme: data.theme_name, themeId: data.theme_id });
      } else {
        toast({
          title: "No suggestion",
          description: `Could not determine a theme for ${symbol}. Please add it manually.`,
        });
      }
    } catch {
      toast({ title: "Error", description: "Failed to get suggestion", variant: "destructive" });
    }
    setSuggesting(false);
  };

  const acceptSuggestion = async () => {
    if (!suggestion) return;
    await addTickers(suggestion.themeId, suggestion.symbol);
    setSuggestion(null);
    setSmartTickerInput("");
  };

  const filteredThemes = searchQuery
    ? themes.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : themes;

  if (authLoading || (!user && !authLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={16} /> Dashboard
            </button>
            <h1 className="text-xl font-bold text-foreground">Manage Themes & Tickers</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut size={16} />
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-6 space-y-8">
        {/* ─── Smart Add (No Theme) ─── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">
            Smart Add Ticker
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Enter a ticker symbol and we'll suggest which theme to add it to.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. NVDA"
              value={smartTickerInput}
              onChange={(e) => setSmartTickerInput(e.target.value.toUpperCase())}
              maxLength={10}
              className="max-w-[200px] font-mono"
              onKeyDown={(e) => e.key === "Enter" && suggestTheme()}
            />
            <Button onClick={suggestTheme} disabled={suggesting} size="sm">
              {suggesting ? <Loader2 size={14} className="animate-spin" /> : "Suggest Theme"}
            </Button>
          </div>
          {suggestion && (
            <div className="mt-3 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm text-foreground">
                Add <span className="font-mono font-bold">{suggestion.symbol}</span> to{" "}
                <span className="font-semibold text-primary">{suggestion.theme}</span>?
              </p>
              <Button size="sm" onClick={acceptSuggestion}>Yes</Button>
              <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>No</Button>
            </div>
          )}
        </section>

        {/* ─── Create New Theme ─── */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">
            Create New Theme
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 space-y-1">
              <Label htmlFor="theme-name" className="text-xs">Theme Name *</Label>
              <Input
                id="theme-name"
                placeholder="e.g. Quantum Computing"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="theme-desc" className="text-xs">Description (optional)</Label>
              <Input
                id="theme-desc"
                placeholder="Short description"
                value={newThemeDesc}
                onChange={(e) => setNewThemeDesc(e.target.value)}
                maxLength={200}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={createTheme} disabled={creating || !newThemeName.trim()}>
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create
              </Button>
            </div>
          </div>
        </section>

        {/* ─── Search ─── */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search themes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* ─── Themes List ─── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-primary" size={24} />
          </div>
        ) : (
          <div className="space-y-2">
            {filteredThemes.map((theme) => {
              const themeTickers = tickers.filter((t) => t.theme_id === theme.id);
              const isExpanded = expandedTheme === theme.id;
              const isEditing = editingTheme === theme.id;

              return (
                <div
                  key={theme.id}
                  className="rounded-lg border border-border bg-card transition-colors"
                >
                  {/* Theme header row */}
                  <div
                    className="flex cursor-pointer items-center gap-3 p-4"
                    onClick={() => setExpandedTheme(isExpanded ? null : theme.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {theme.name}
                      </h3>
                      {theme.description && (
                        <p className="truncate text-xs text-muted-foreground">{theme.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                      {themeTickers.length} tickers
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isEditing) {
                          setEditingTheme(null);
                        } else {
                          setEditingTheme(theme.id);
                          setEditName(theme.name);
                          setEditDesc(theme.description || "");
                        }
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {isEditing ? "Cancel" : "Edit"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTheme(theme.id, theme.name);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Edit form */}
                  {isEditing && (
                    <div className="border-t border-border px-4 py-3">
                      <div className="flex gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Theme name"
                          maxLength={100}
                          className="flex-1"
                        />
                        <Input
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          placeholder="Description"
                          maxLength={200}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={() => updateTheme(theme.id)}>
                          Save
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Expanded: tickers + add form */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3">
                      {/* Add tickers */}
                      <div className="mb-3 flex gap-2">
                        <Input
                          placeholder="NVDA, AMD, TSM (comma-separated)"
                          value={tickerInput[theme.id] || ""}
                          onChange={(e) =>
                            setTickerInput((prev) => ({ ...prev, [theme.id]: e.target.value.toUpperCase() }))
                          }
                          className="flex-1 font-mono text-xs"
                          maxLength={200}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") addTickers(theme.id, tickerInput[theme.id] || "");
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => addTickers(theme.id, tickerInput[theme.id] || "")}
                          disabled={addingTicker === theme.id}
                        >
                          {addingTicker === theme.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Plus size={14} />
                          )}
                          Add
                        </Button>
                      </div>

                      {/* Ticker list */}
                      {themeTickers.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No tickers yet. Add some above.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {themeTickers
                            .sort((a, b) => a.ticker_symbol.localeCompare(b.ticker_symbol))
                            .map((tk) => (
                              <span
                                key={tk.id}
                                className="inline-flex items-center gap-1 rounded bg-secondary px-2 py-1 font-mono text-xs text-foreground"
                              >
                                {tk.ticker_symbol}
                                <button
                                  onClick={() => deleteTicker(tk.id, tk.ticker_symbol)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          {themes.length} themes · {tickers.length} total tickers
        </p>
      </main>
    </div>
  );
}
