.page { padding: 26px 26px 48px; }
.header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 22px; }
.title { font-family: 'Cormorant Garamond', serif; font-size: 24px; font-weight: 600; color: var(--text); margin-bottom: 3px; letter-spacing: 0.02em; }
.sub { font-size: 12px; color: var(--text2); }
.backBtn { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text3); background: none; border: none; padding: 0; margin-bottom: 8px; cursor: pointer; transition: color 0.15s; }
.backBtn:hover { color: var(--gold-light); }

.folderGrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; }
.folderCard { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; display: flex; align-items: stretch; transition: all 0.2s; }
.folderCard:hover { border-color: var(--gold-border); }
.folderCardInner { flex: 1; padding: 17px; cursor: pointer; }
.folderIcon { width: 38px; height: 38px; border-radius: 9px; background: var(--gold-bg); color: var(--gold-light); display: flex; align-items: center; justify-content: center; font-size: 18px; margin-bottom: 11px; }
.folderName { font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 3px; }
.folderCount { font-size: 11px; color: var(--text3); }
.folderDelete { background: none; border: none; border-left: 1px solid var(--border); padding: 0 14px; color: var(--text3); cursor: pointer; transition: all 0.15s; font-size: 14px; }
.folderDelete:hover { background: var(--coral-bg); color: var(--coral); }
.folderDelete:disabled { opacity: 0.4; cursor: not-allowed; }

.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 400; }
.modal { background: var(--surface); border: 1px solid var(--border2); border-radius: var(--radius-lg); padding: 28px; width: 100%; max-width: 400px; }
.modalTitle { font-family: 'Cormorant Garamond', serif; font-size: 20px; font-weight: 600; color: var(--text); margin-bottom: 20px; }
.field { margin-bottom: 14px; }
.label { display: block; font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text3); margin-bottom: 5px; }
.input { width: 100%; background: var(--surface2); border: 1px solid var(--border2); border-radius: 8px; padding: 9px 12px; font-size: 13px; color: var(--text); outline: none; transition: border-color 0.15s; font-family: inherit; }
.input:focus { border-color: var(--gold-border); }
.input::placeholder { color: var(--text3); }
.modalActions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

.section { margin-bottom: 28px; }
.sectionLabel { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text3); margin-bottom: 11px; padding-bottom: 7px; border-bottom: 1px solid var(--border); }

.mediaGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 9px; }
.thumb { border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); aspect-ratio: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 6px; cursor: pointer; transition: border-color 0.15s; position: relative; overflow: hidden; }
.thumb:hover { border-color: var(--gold-border); }
.thumb:hover .thumbOverlay { opacity: 1; }
.thumbImg { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }
.thumbFile { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.thumbOverlay { position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s; font-size: 20px; color: var(--gold-light); }
.thumbLabel { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); padding: 4px 6px; font-size: 9px; color: var(--text2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.empty { padding: 24px; text-align: center; font-size: 13px; color: var(--text3); }
.emptyState { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 24px; text-align: center; }

.thumbDelete { position: absolute; top: 5px; right: 5px; width: 22px; height: 22px; border-radius: 50%; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); color: var(--text2); font-size: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; transition: opacity 0.15s; }
.thumb:hover .thumbDelete { opacity: 1; }
.thumbDelete:hover { background: var(--coral); color: #fff; border-color: var(--coral); }

.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 500; }
.lightboxInner { position: relative; max-width: 90vw; max-height: 90vh; }
.lightboxClose { position: absolute; top: -40px; right: 0; background: none; border: none; color: var(--text2); font-size: 20px; cursor: pointer; }
.lightboxClose:hover { color: var(--text); }
.lightboxMedia { max-width: 80vw; max-height: 80vh; border-radius: var(--radius); display: block; }
.lightboxName { font-size: 11px; color: var(--text3); text-align: center; margin-top: 8px; }
