package server

import "testing"

func TestInferChannelMediaExtForAudioWithoutFilename(t *testing.T) {
	testCases := []struct {
		name        string
		contentType string
		wantExt     string
	}{
		{name: "ogg", contentType: "audio/ogg; codecs=opus", wantExt: ".ogg"},
		{name: "application ogg", contentType: "application/ogg", wantExt: ".ogg"},
		{name: "mpeg", contentType: "audio/mpeg", wantExt: ".mp3"},
		{name: "mp3", contentType: "audio/mp3", wantExt: ".mp3"},
		{name: "wav", contentType: "audio/x-wav", wantExt: ".wav"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := inferChannelMediaExt("file", tc.contentType); got != tc.wantExt {
				t.Fatalf("inferChannelMediaExt(%q) = %q, want %q", tc.contentType, got, tc.wantExt)
			}
			if !allowedFileExts[tc.wantExt] {
				t.Fatalf("inferred extension %q is not an allowed file type", tc.wantExt)
			}
		})
	}
}
