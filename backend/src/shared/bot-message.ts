// One message format for every channel and every agent. Change only with lead review.
export type Channel = 'whatsapp' | 'sms' | 'email' | 'web';

export interface BotButton {
  id: string;
  label: string;
}

export interface BotMedia {
  type: 'image' | 'audio' | 'document';
  url: string;
  mimeType?: string;
}

export interface BotMessage {
  direction: 'inbound' | 'outbound';
  tripId?: string;
  companyId?: string;
  personId?: string;
  channel: Channel;
  language: string;
  text?: string;
  buttons?: BotButton[];
  media?: BotMedia[];
}
