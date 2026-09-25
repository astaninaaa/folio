/* =============================================================================
   global.js — общий JS-код для всех страниц
   Содержит: таймер футера, полноценный аудиоплеер (загрузка треков из JSON)
   ============================================================================= */

'use strict';

/* ─── Таймер (Новосибирск) ──────────────────────────────────────────────────── */
(function initNovosibirskTimer() {
  const timerEl = document.getElementById('footer-timer');
  if (!timerEl) return;
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Novosibirsk',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  function updateTime() {
    try {
      const timeStr = formatter.format(new Date());
      timerEl.textContent = `${timeStr} +7 GMT`;
    } catch (_) {
      timerEl.style.display = 'none';
    }
  }
  updateTime();
  setInterval(updateTime, 60_000);
})();


/* ═══════════════════════════════════════════════════════════════════════════════
   ПЛЕЕР — полная логика с загрузкой треков из JSON
   ═══════════════════════════════════════════════════════════════════════════════ */

(function initPlayer() {
  // ─── DOM-ссылки ──────────────────────────────────────────────────────────────
  const audio = document.getElementById('player-audio');
  const playBtn = document.getElementById('play-pause-btn');
  const prevBtn = document.querySelector('.winamp-prev');
  const nextBtn = document.querySelector('.winamp-next');
  const volumeBtn = document.getElementById('volume-btn');
  const volumeSlider = document.getElementById('volume-slider');
  const playlistWrapper = document.getElementById('playlist-wrapper');
  const playlistBtn = document.getElementById('playlist-btn');
  const playlistItems = document.querySelector('.playlist-items');
  const errorEl = document.getElementById('player-error');

  if (!audio || !playBtn) return; // если нет аудио — выходим

  if (playlistWrapper && playlistBtn) {
    // Функция переключения
    const togglePlaylist = function(e) {
      e.stopPropagation();
      playlistWrapper.classList.toggle('show');
    };

    // Обработчики для мыши и сенсорного экрана
    playlistBtn.addEventListener('click', togglePlaylist);
    playlistBtn.addEventListener('touchend', function(e) {
      // Предотвращаем дублирование событий на телефонах
      e.preventDefault();
      togglePlaylist(e);
    });

    // Закрытие при клике снаружи
    document.addEventListener('click', function(e) {
      // ГЛАВНОЕ ИСПРАВЛЕНИЕ: contains() работает даже если кликнули по SVG внутри кнопки!
      if (!playlistWrapper.contains(e.target) && !playlistBtn.contains(e.target)) {
        playlistWrapper.classList.remove('show');
      }
    });
  }


  // ─── Состояние ──────────────────────────────────────────────────────────────
  const state = {
    tracks: [],          // будет заполнено из JSON
    currentIndex: 0,
    isPlaying: false,
    volume: 0.2,
    isMuted: false,
    prevVolume: 0.2,
    fadeInterval: null,
    targetVolume: 0.2,
  };

  const FADE_STEP = 0.2;        // шаг изменения громкости
  const FADE_INTERVAL = 30;      // интервал в мс

  // ─── Фоновые слои (только на главной) ─────────────────────────────────────
  const path = window.location.pathname;
  const isHome = path === '/' 
    || path.endsWith('/') 
    || path.endsWith('/index.html');
  const bgLayer1 = document.querySelector('.bg-layer-1');
  const bgLayer2 = document.querySelector('.bg-layer-2');
  let activeBgLayer = 1; // 1 или 2, какой сейчас виден

  if (isHome && bgLayer1 && bgLayer2) {
    document.body.classList.add('is-home');
    // Инициализируем первый слой белым фоном (пока трек не загружен)
    bgLayer1.style.backgroundImage = 'none';
    bgLayer1.style.opacity = '1';
    bgLayer2.style.backgroundImage = 'none';
    bgLayer2.style.opacity = '0';
  }

  // ─── Вспомогательные функции ──────────────────────────────────────────────

  /** Безопасное сохранение в localStorage */
  function saveState() {
    if (!state.tracks.length) return;
    try {
      localStorage.setItem('player_track', state.tracks[state.currentIndex].id);
      localStorage.setItem('player_volume', String(state.volume));
      localStorage.setItem('player_playing', String(state.isPlaying));
    } catch (_) {}
  }

  /** Загрузка сохранённого состояния (вызывается после автозапуска) */
  function restoreState() {
    if (!state.tracks.length) return;
    try {
      const savedTrack = localStorage.getItem('player_track');
      const savedVolume = localStorage.getItem('player_volume');
      const savedPlaying = localStorage.getItem('player_playing');

      if (savedTrack) {
        const idx = state.tracks.findIndex(t => t.id === savedTrack);
        if (idx !== -1) state.currentIndex = idx;
      }
      if (savedVolume !== null) {
        const vol = parseFloat(savedVolume);
        if (!isNaN(vol) && vol >= 0 && vol <= 1) {
          state.volume = vol;
          state.targetVolume = vol;
          state.prevVolume = vol;
        }
      }
      if (savedPlaying === 'true') {
        state.isPlaying = true;
      } else {
        state.isPlaying = false;
      }
    } catch (_) {}
  }

  /** Обновить UI в соответствии с состоянием */
  function updateUI() {
    if (!state.tracks.length) return;
    // Кнопка Play/Pause
    if (state.isPlaying) {
      playBtn.classList.add('playing');
      playBtn.setAttribute('aria-label', 'Поставить на паузу');
    } else {
      playBtn.classList.remove('playing');
      playBtn.setAttribute('aria-label', 'Воспроизвести');
    }
    // Снять состояние загрузки (лоадер)
    playBtn.classList.remove('loading');

    // Громкость
    volumeSlider.value = state.volume * 100;
    const volIcon = volumeBtn.querySelector('.icon-volume');
    const muteIcon = volumeBtn.querySelector('.icon-mute');
    if (state.isMuted || state.volume === 0) {
      if (volIcon) volIcon.style.display = 'none';
      if (muteIcon) muteIcon.style.display = 'block';
    } else {
      if (volIcon) volIcon.style.display = 'block';
      if (muteIcon) muteIcon.style.display = 'none';
    }

    // Активный трек в списке
    const items = playlistItems.querySelectorAll('li');
    items.forEach((li, idx) => {
      const isActive = idx === state.currentIndex;
      li.classList.toggle('active', isActive && state.isPlaying);
    });

    // Фоновый слой (если главная)
    if (isHome && bgLayer1 && bgLayer2 && state.tracks.length) {
      // Если музыка не играет — скрываем оба слоя
      if (!state.isPlaying) {
        bgLayer1.style.opacity = '0';
        bgLayer2.style.opacity = '0';
        return;
      }

      // Если музыка играет — показываем текущий слой
      const bgUrl = state.tracks[state.currentIndex].bg;
      if (!bgUrl) return;

      const targetLayer = activeBgLayer === 1 ? bgLayer2 : bgLayer1;
      const currentLayer = activeBgLayer === 1 ? bgLayer1 : bgLayer2;

      const img = new Image();
      img.onload = function() {
        targetLayer.style.backgroundImage = `url(${bgUrl})`;
        requestAnimationFrame(() => {
          currentLayer.style.opacity = '0';
          targetLayer.style.opacity = '1';
          activeBgLayer = activeBgLayer === 1 ? 2 : 1;
        });
      };
      img.onerror = function() {
        targetLayer.style.backgroundImage = 'none';
        requestAnimationFrame(() => {
          currentLayer.style.opacity = '0';
          targetLayer.style.opacity = '1';
          activeBgLayer = activeBgLayer === 1 ? 2 : 1;
        });
      };
      img.src = bgUrl;
    }
  }

  /** Показать микро-подсказку об ошибке на 3 секунды */
  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message || 'Ошибка загрузки звука. Проверьте сеть';
    errorEl.classList.add('is-visible');
    errorEl.removeAttribute('hidden');
    clearTimeout(errorEl._hideTimer);
    errorEl._hideTimer = setTimeout(() => {
      errorEl.classList.remove('is-visible');
      errorEl.setAttribute('hidden', '');
    }, 3000);
  }

  /** Плавное затухание и переключение трека */
  function loadTrack(index, autoPlay = false) {
    if (!state.tracks.length) return;
    if (index < 0) index = state.tracks.length - 1;
    if (index >= state.tracks.length) index = 0;
    state.currentIndex = index;

    // Если есть активное затухание — прерываем
    if (state.fadeInterval) {
      clearInterval(state.fadeInterval);
      state.fadeInterval = null;
    }

    const targetVol = state.volume;
    const currentVol = audio.volume;

    // Если звук уже играет — плавно затухаем до 0
    if (!audio.paused && currentVol > 0) {
      let vol = currentVol;
      const step = FADE_STEP;
      state.fadeInterval = setInterval(() => {
        vol = Math.max(0, vol - step);
        audio.volume = vol;
        if (vol <= 0) {
          clearInterval(state.fadeInterval);
          state.fadeInterval = null;
          // Меняем src и запускаем
          changeSrcAndPlay(index, autoPlay, targetVol);
        }
      }, FADE_INTERVAL);
    } else {
      // Если на паузе или громкость 0 — сразу меняем
      changeSrcAndPlay(index, autoPlay, targetVol);
    }
  }

  /** Меняет src, загружает и (если нужно) запускает с плавным нарастанием */
  function changeSrcAndPlay(index, autoPlay, targetVol) {
    if (!state.tracks.length) return;
    audio.src = state.tracks[index].audio;
    audio.load();

    if (autoPlay || state.isPlaying) {
      // Мгновенно переключаем UI в состояние "играет"
      state.isPlaying = true;
      updateUI();
      saveState();

      // Ждём готовности аудио
      const onCanPlay = function() {
        audio.removeEventListener('canplaythrough', onCanPlay);
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            // Плавно наращиваем громкость
            audio.volume = 0;
            let vol = 0;
            state.fadeInterval = setInterval(() => {
              vol = Math.min(targetVol, vol + FADE_STEP);
              audio.volume = vol;
              if (vol >= targetVol) {
                clearInterval(state.fadeInterval);
                state.fadeInterval = null;
              }
            }, FADE_INTERVAL);
          }).catch(() => {
            // Если блокировка или ошибка — возвращаем паузу
            state.isPlaying = false;
            updateUI();
            saveState();
          });
        }
      };
      audio.addEventListener('canplaythrough', onCanPlay);
    } else {
      // Без воспроизведения — просто загружаем
      audio.volume = targetVol;
      state.isPlaying = false;
      updateUI();
      saveState();
    }
  }

  /** Переключение на следующий/предыдущий трек */
  function nextTrack() {
    if (!state.tracks.length) return;
    const nextIdx = (state.currentIndex + 1) % state.tracks.length;
    loadTrack(nextIdx, true);
  }
  function prevTrack() {
    if (!state.tracks.length) return;
    const prevIdx = (state.currentIndex - 1 + state.tracks.length) % state.tracks.length;
    loadTrack(prevIdx, true);
  }

  /** Воспроизвести/пауза */
  function togglePlay() {
    if (!state.tracks.length) return;
    if (audio.paused) {
      // Если трек не загружен или закончился — перезагружаем текущий
      if (!audio.src || audio.ended) {
        loadTrack(state.currentIndex, true);
        return;
      }
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          state.isPlaying = true;
          updateUI();
          saveState();
        }).catch(() => {
          showError('Не удалось воспроизвести звук');
        });
      }
    } else {
      audio.pause();
      state.isPlaying = false;
      updateUI();
      saveState();
    }
  }

  /** Установить громкость */
  function setVolume(val) {
    const vol = Math.min(1, Math.max(0, val));
    state.volume = vol;
    state.targetVolume = vol;
    state.prevVolume = vol;
    audio.volume = vol;
    if (vol === 0) {
      state.isMuted = true;
    } else {
      state.isMuted = false;
    }
    updateUI();
    saveState();
  }

  /** Переключение mute */
  function toggleMute() {
    if (state.isMuted) {
      state.isMuted = false;
      const vol = state.prevVolume || 0.2;
      setVolume(vol);
    } else {
      state.isMuted = true;
      state.prevVolume = state.volume;
      setVolume(0);
    }
  }

  // ─── Рендер плейлиста ──────────────────────────────────────────────────────

  function renderPlaylist() {
    if (!playlistItems || !state.tracks.length) return;
    playlistItems.innerHTML = '';
    state.tracks.forEach((track, idx) => {

      const li = document.createElement('li');
      li.dataset.index = idx;

      const numSpan = document.createElement('span');
      numSpan.className = 'pl-num';
      const isActive = idx === state.currentIndex;
      numSpan.textContent = (isActive && state.isPlaying)
        ? '▶'
        : String(idx + 1).padStart(2, '0');

      const nameSpan = document.createElement('span');
      nameSpan.className = 'pl-name';
      nameSpan.textContent = track.name;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'pl-time';
      if (track.duration) {
        const mins = Math.floor(track.duration / 60);
        const secs = String(track.duration % 60).padStart(2, '0');
        timeSpan.textContent = `${mins}:${secs}`;
      }

      li.appendChild(numSpan);
      li.appendChild(nameSpan);
      li.appendChild(timeSpan);


      li.addEventListener('click', (e) => {
        e.stopPropagation();
        // Если кликнули по уже играющему треку — ставим на паузу
        if (idx === state.currentIndex && state.isPlaying) {
          audio.pause();
          state.isPlaying = false;
          updateUI();
          saveState();
          playlistWrapper.classList.remove('show');
          return;
        }
        // Иначе переключаем трек
        loadTrack(idx, true);
        playlistWrapper.classList.remove('show');
      });
      playlistItems.appendChild(li);
    });
    updateUI();
  }

  // ─── Обработчики событий аудио ─────────────────────────────────────────────

  audio.addEventListener('ended', () => {
    nextTrack();
  });

  audio.addEventListener('error', () => {
    showError('Ошибка загрузки звука. Проверьте сеть');
    state.isPlaying = false;
    updateUI();
    saveState();
  });

  audio.addEventListener('waiting', () => {
    playBtn.classList.add('loading');
  });

  audio.addEventListener('playing', () => {
    playBtn.classList.remove('loading');
  });

  // ─── Загрузка треков из JSON и инициализация ──────────────────────────────

  async function loadTracksAndInit() {
    try {
      const response = await fetch('data/tracks.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) throw new Error('Пустой список треков');
      state.tracks = data;
      // Восстанавливаем сохранённое состояние (трек, громкость)
      restoreState();

      // Инициализация после загрузки
      // Загружаем дефолтный трек (индекс 0) без воспроизведения
      // Загружаем трек (сохранённый или первый)
      audio.src = state.tracks[state.currentIndex].audio;
      audio.load();
      // Принудительно останавливаем воспроизведение при загрузке, чтобы избежать автозапуска
      audio.pause();
      state.isPlaying = false;
      audio.volume = state.volume || 0.2;
      if (isHome && bgLayer1 && bgLayer2) {
        bgLayer1.style.opacity = '0';
        bgLayer2.style.opacity = '0';
      }
      // Рендерим плейлист и обновляем UI
      renderPlaylist();
      updateUI();

      // Навешиваем обработчики на кнопки UI (после того как всё готово)
      initEventListeners();

    } catch (err) {
      console.warn('[global.js] Ошибка загрузки tracks.json:', err);
      showError('Не удалось загрузить список треков. Перезагрузите страницу.');
      // Показываем плейлист с заглушкой
      if (playlistItems) {
        playlistItems.innerHTML = '<li style="color:var(--text-footer);padding:12px 16px;">Ошибка загрузки</li>';
      }
    }
  }

  // ─── Навешиваем события на кнопки UI (вызывается после инициализации) ────

  function initEventListeners() {
    // Play/Pause
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });

    // Prev / Next
    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        prevTrack();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextTrack();
      });
    }

    // Громкость (кнопка mute)
    if (volumeBtn) {
      volumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMute();
      });
    }

    // Ползунок громкости
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value) / 100;
        setVolume(val);
        if (val > 0 && state.isMuted) {
          state.isMuted = false;
          updateUI();
        }
      });
    }

    // Открытие/закрытие плейлиста
    if (playlistBtn && playlistWrapper) {
      playlistBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playlistWrapper.classList.toggle('show');
      });
      document.addEventListener('click', (e) => {
        if (!playlistWrapper.contains(e.target) && !playlistBtn.contains(e.target)) {
          playlistWrapper.classList.remove('show');
        }
      });
    }
  }

  // ─── Старт ──────────────────────────────────────────────────────────────────

  loadTracksAndInit();

})();

/* ─── Список площадок в футере (dropdown) ──────────────────────────────────── */
(function initLinksList() {
  const wrapper = document.getElementById('linkslist-wrapper');
  const btn     = document.getElementById('linkslist-btn');
  if (!wrapper || !btn) return;

  function toggle(e) {
    if (e) e.stopPropagation();
    const isOpen = wrapper.classList.toggle('show');
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  btn.addEventListener('click', toggle);
  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    toggle(e);
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target) && !btn.contains(e.target)) {
      wrapper.classList.remove('show');
      btn.setAttribute('aria-expanded', 'false');
    }
  });

  // Закрытие по Esc, если фокус внутри списка
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrapper.classList.contains('show')) {
      wrapper.classList.remove('show');
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });
})();