import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, FlatList, TextInput, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useApp } from '../data/AppContext';
import { Icons } from './Icons';
import { SERIF } from '../theme';

interface ProductPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (productId: string | string[]) => void;
  excludeIds?: string[];
  initialSelectedIds?: string[];
  title?: string;
  mode?: 'single' | 'multiple';
}

const EMPTY_ARRAY: string[] = [];

export function ProductPicker({ visible, onClose, onSelect, excludeIds = EMPTY_ARRAY, initialSelectedIds = EMPTY_ARRAY, title = 'Add product', mode = 'single' }: ProductPickerProps) {
  const { theme, products } = useApp();
  const [search, setSearch] = useState('');
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);

  // Update local state when visible changes (to reset or sync)
  React.useEffect(() => {
    if (visible) setSelectedIds(initialSelectedIds);
  }, [visible, initialSelectedIds]);

  const availableProducts = useMemo(() => {
    return products.filter(p => !excludeIds.includes(p.id));
  }, [products, excludeIds]);

  const brands = useMemo(() => {
    const b = new Set<string>();
    availableProducts.forEach(p => {
      if (p.brand) b.add(p.brand);
    });
    return Array.from(b).sort();
  }, [availableProducts]);

  const filtered = useMemo(() => {
    let res = availableProducts;
    if (activeBrand) {
      res = res.filter(p => p.brand === activeBrand);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      res = res.filter(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));
    }
    return res;
  }, [availableProducts, activeBrand, search]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.sheetOverlay}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={[styles.sheet, { backgroundColor: theme.bg }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.header}>
              <Text style={[styles.sheetTitle, { color: theme.ink }]}>{title}</Text>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Icons.close size={16} color={theme.ink3} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
              <View style={[styles.searchBox, { backgroundColor: theme.bg2 }]}>
                <Icons.search size={16} color={theme.ink3} />
                <TextInput
                  style={[styles.searchInput, { color: theme.ink }]}
                  placeholder="Search products..."
                  placeholderTextColor={theme.ink3}
                  value={search}
                  onChangeText={setSearch}
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')}>
                    <Icons.close size={14} color={theme.ink3} />
                  </Pressable>
                )}
              </View>
            </View>

            {brands.length > 0 && (
              <View style={{ paddingBottom: 12 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
                  <Pressable
                    onPress={() => setActiveBrand(null)}
                    style={[styles.chip, { backgroundColor: activeBrand === null ? theme.accent : theme.bg2 }]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '500', color: activeBrand === null ? '#fff' : theme.ink2 }}>All</Text>
                  </Pressable>
                  {brands.map(b => (
                    <Pressable
                      key={b}
                      onPress={() => setActiveBrand(b)}
                      style={[styles.chip, { backgroundColor: activeBrand === b ? theme.accent : theme.bg2 }]}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '500', color: activeBrand === b ? '#fff' : theme.ink2 }}>{b}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 400 }}
              contentContainerStyle={{ paddingBottom: 20 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selectedIds.includes(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      if (mode === 'single') {
                        onSelect(item.id);
                        setSearch('');
                        setActiveBrand(null);
                        onClose();
                      } else {
                        setSelectedIds(prev => 
                          prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id]
                        );
                      }
                    }}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      { borderColor: theme.line, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    {mode === 'multiple' ? (
                      <View style={[styles.pickerCheck, {
                        backgroundColor: isSelected ? theme.accent : 'transparent',
                        borderColor: isSelected ? theme.accent : theme.ink3,
                      }]}>
                        {isSelected && <Icons.check size={12} color="#fff" />}
                      </View>
                    ) : (
                      <View style={[styles.pickerSwatch, { backgroundColor: theme.bg2 }]}>
                        <Text style={[styles.pickerSwatchText, { color: theme.ink3 }]}>
                          {item.brand.slice(0, 3).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: mode === 'multiple' ? 12 : 0 }}>
                      <Text style={[styles.pickerName, { color: theme.ink }]}>{item.name}</Text>
                      <Text style={[styles.pickerBrand, { color: theme.ink2 }]}>{item.brand}</Text>
                    </View>
                    <Text style={[styles.pickerUnit, { color: theme.ink3 }]}>{item.perUse}{item.unit}</Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={() => (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: theme.ink3 }}>No products found</Text>
                </View>
              )}
            />
            
            {mode === 'multiple' && (
              <Pressable
                onPress={() => {
                  onSelect(selectedIds);
                  setSearch('');
                  setActiveBrand(null);
                  onClose();
                }}
                style={[styles.pickerDone, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.pickerDoneText}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(150,150,150,0.3)', alignSelf: 'center', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontFamily: SERIF },
  closeBtn: { padding: 4 },
  
  searchBox: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 44, borderRadius: 12, gap: 10 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500' },
  
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  
  pickerRow: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 0.5 },
  pickerSwatch: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  pickerSwatchText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  pickerName: { fontSize: 15, fontWeight: '500', marginBottom: 2 },
  pickerBrand: { fontSize: 12 },
  pickerUnit: { fontSize: 14, fontWeight: '600' },
  pickerCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  pickerDone: { margin: 20, padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  pickerDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
