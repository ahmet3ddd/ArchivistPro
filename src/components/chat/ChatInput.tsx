import { chatStyles as styles } from './chatStyles';

interface ChatInputProps {
    input: string;
    onInputChange: (value: string) => void;
    onSend: () => void;
    onAbort: () => void;
    busy: boolean;
    t: (key: string, fallback?: string) => string;
}

export default function ChatInput({ input, onInputChange, onSend, onAbort, busy, t }: ChatInputProps) {
    return (
        <div style={styles.inputRow}>
            <textarea
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        onSend();
                    }
                }}
                placeholder={t('chat.input.placeholder', "Arşive soru sor — '/görsel <metin>' ile görsel ara (Enter = gönder)")}
                style={styles.textarea}
                disabled={busy}
            />
            {busy ? (
                <button
                    style={{ ...styles.sendBtn, background: '#e53e3e' }}
                    onClick={onAbort}
                >{t('chat.abort')}</button>
            ) : (
                <button
                    style={{ ...styles.sendBtn, opacity: !input.trim() ? 0.5 : 1 }}
                    onClick={onSend}
                    disabled={!input.trim()}
                >{t('chat.send')}</button>
            )}
        </div>
    );
}
