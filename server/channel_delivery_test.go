package server

import "testing"

func TestChannelInboundMediaClassifiesAudioForPlayback(t *testing.T) {
	testCases := []struct {
		name            string
		file            uploadPayload
		wantBlockType   string
		wantMessageType string
	}{
		{
			name: "voice attachment",
			file: uploadPayload{
				Type:     "file",
				Name:     "voice.ogg",
				MimeType: "audio/ogg; codecs=opus",
			},
			wantBlockType:   "audio",
			wantMessageType: "voice",
		},
		{
			name: "image attachment",
			file: uploadPayload{
				Type:     "image",
				Name:     "cat.png",
				MimeType: "image/png",
			},
			wantBlockType:   "image",
			wantMessageType: "image",
		},
		{
			name: "document attachment",
			file: uploadPayload{
				Type:     "file",
				Name:     "report.pdf",
				MimeType: "application/pdf",
			},
			wantBlockType:   "file",
			wantMessageType: "file",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			blocks := channelInboundContentBlocks("", []uploadPayload{tc.file})
			if len(blocks) != 1 {
				t.Fatalf("content blocks = %#v, want one block", blocks)
			}
			if got := blocks[0].Type; got != tc.wantBlockType {
				t.Fatalf("block type = %q, want %q", got, tc.wantBlockType)
			}
			if got := channelInboundMessageType(tc.file); got != tc.wantMessageType {
				t.Fatalf("message type = %q, want %q", got, tc.wantMessageType)
			}
		})
	}
}
