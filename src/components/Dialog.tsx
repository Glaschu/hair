import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Icons } from './Icons';
import { typography } from '../theme';
import type { Theme } from '../theme';
import { useApp } from '../data/AppContext';

export type DialogTone = 'default' | 'destructive';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
}

export interface AlertOptions {
  title: string;
  message?: string;
  okLabel?: string;
}

export interface ActionSheetAction {
  label: string;
  destructive?: boolean;
}

export interface ActionSheetOptions {
  title?: string;
  message?: string;
  actions: ActionSheetAction[];
  cancelLabel?: string;
}

export type DialogRequest =
  | { kind: 'confirm'; opts: ConfirmOptions }
  | { kind: 'alert'; opts: AlertOptions }
  | { kind: 'actionSheet'; opts: ActionSheetOptions };

export interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
  actionSheet: (opts: ActionSheetOptions) => Promise<number | null>;
}

// Value passed when a dialog is dismissed without an explicit choice.
function cancelValue(req: DialogRequest): boolean | number | null | undefined {
  if (req.kind === 'confirm') return false;
  if (req.kind === 'actionSheet') return null;
  return undefined;
}

interface DialogHostProps {
  request: DialogRequest | null;
  theme: Theme;
  onResolve: (value: boolean | number | null | undefined) => void;
}

/** Pure presentation component — renders the themed bottom sheet. Holds no context. */
export function DialogHost({ request, theme, onResolve }: DialogHostProps) {
  // Keep the last request rendered while the modal slides out.
  const [shown, setShown] = useState<DialogRequest | null>(null);
  if (request && request !== shown) setShown(request);

  const visible = request !== null;
  const req = shown;

  const dismiss = () => req && onResolve(cancelValue(req));

  const choose = (
    value: boolean | number | null | undefined,
    opts?: { destructive?: boolean },
  ) => {
    if (opts?.destructive) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onResolve(value);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <View style={[styles.overlay, { backgroundColor: theme.dark ? 'rgba(0,0,0,0.62)' : 'rgba(0,0,0,0.4)' }]}>
        <Pressable style={styles.backdrop} onPress={dismiss} />
        {req && (
          <View style={[styles.sheet, { backgroundColor: theme.card }]}>
            <View style={[styles.handle, { backgroundColor: theme.ink3 }]} />

            {req.kind === 'confirm' && req.opts.tone === 'destructive' && (
              <View style={[styles.iconWrap, { backgroundColor: theme.danger + '1A' }]}>
                <Icons.alert size={22} color={theme.danger} />
              </View>
            )}

            {(req.kind !== 'actionSheet' || req.opts.title) && (
              <Text style={[styles.title, typography.serif(21), { color: theme.ink }]}>
                {req.opts.title}
              </Text>
            )}
            {req.opts.message ? (
              <Text style={[styles.message, typography.sans(14), { color: theme.ink2 }]}>
                {req.opts.message}
              </Text>
            ) : null}

            {req.kind === 'confirm' && (
              <View style={styles.btnGroup}>
                <Pressable
                  onPress={() => choose(true, { destructive: req.opts.tone === 'destructive' })}
                  style={({ pressed }) => [
                    styles.btn,
                    {
                      backgroundColor: req.opts.tone === 'destructive' ? theme.danger : theme.accent,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <Text style={[typography.sansMedium(14), styles.btnLabel, { color: '#fff' }]}>
                    {req.opts.confirmLabel ?? 'Confirm'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => choose(false)}
                  style={({ pressed }) => [
                    styles.btn,
                    { backgroundColor: theme.bg2, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={[typography.sansMedium(14), styles.btnLabel, { color: theme.ink2 }]}>
                    {req.opts.cancelLabel ?? 'Cancel'}
                  </Text>
                </Pressable>
              </View>
            )}

            {req.kind === 'alert' && (
              <View style={styles.btnGroup}>
                <Pressable
                  onPress={() => choose(undefined)}
                  style={({ pressed }) => [
                    styles.btn,
                    { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={[typography.sansMedium(14), styles.btnLabel, { color: '#fff' }]}>
                    {req.opts.okLabel ?? 'OK'}
                  </Text>
                </Pressable>
              </View>
            )}

            {req.kind === 'actionSheet' && (
              <View style={styles.btnGroup}>
                <View style={[styles.actionList, { borderColor: theme.line }]}>
                  {req.opts.actions.map((action, i) => (
                    <Pressable
                      key={`${action.label}-${i}`}
                      onPress={() => choose(i, { destructive: action.destructive })}
                      style={({ pressed }) => [
                        styles.actionRow,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
                        { backgroundColor: pressed ? theme.bg2 : 'transparent' },
                      ]}
                    >
                      <Text
                        style={[
                          typography.sansMedium(15),
                          styles.actionLabel,
                          { color: action.destructive ? theme.danger : theme.ink },
                        ]}
                      >
                        {action.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  onPress={() => choose(null)}
                  style={({ pressed }) => [
                    styles.btn,
                    { backgroundColor: theme.bg2, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Text style={[typography.sansMedium(14), styles.btnLabel, { color: theme.ink2 }]}>
                    {req.opts.cancelLabel ?? 'Cancel'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

/**
 * Self-contained dialog instance. Returns the imperative API plus a `dialog`
 * element the caller must render. Used directly inside ScanModal (a screen
 * presented as a modal) so the dialog stacks correctly; the app-wide
 * DialogProvider builds on this same hook.
 */
export function useLocalDialog(): DialogApi & { dialog: React.ReactElement } {
  const { theme } = useApp();
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const resolverRef = useRef<((value: any) => void) | null>(null);

  const show = useCallback(<T,>(req: DialogRequest): Promise<T> => {
    return new Promise<T>((resolve) => {
      resolverRef.current = resolve;
      setRequest(req);
    });
  }, []);

  const resolve = useCallback((value: boolean | number | null | undefined) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (r) r(value);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) => show<boolean>({ kind: 'confirm', opts }),
    [show],
  );
  const alert = useCallback(
    (opts: AlertOptions) => show<void>({ kind: 'alert', opts }),
    [show],
  );
  const actionSheet = useCallback(
    (opts: ActionSheetOptions) => show<number | null>({ kind: 'actionSheet', opts }),
    [show],
  );

  const dialog = <DialogHost request={request} theme={theme} onResolve={resolve} />;

  return { confirm, alert, actionSheet, dialog };
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    opacity: 0.4,
    marginBottom: 18,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: { textAlign: 'center' },
  message: {
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 6,
  },
  btnGroup: { marginTop: 20, gap: 10 },
  btn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnLabel: { letterSpacing: 0.1 },
  actionList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  actionRow: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  actionLabel: { letterSpacing: 0.1 },
});
