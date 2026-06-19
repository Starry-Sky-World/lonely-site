'use client';

import { useRef, useState, useEffect, useLayoutEffect, ReactNode, Children } from 'react';
import gsap from 'gsap';
import styles from './SlotWheelTransition.module.css';

interface SlotWheelTransitionProps {
  children: ReactNode;
}

/**
 * 拨码轮切换（Slot Wheel Transition）
 *
 * - 蓄力段（0.1s）：当前 Block 微动，给一点机械阻力感
 * - 释放段（0.4s）：当前 Block 加速翻出，目标 Block 从下方快速滚入
 *   入口用 power3.out（起步快），避免中间出现黑屏空档
 * - 过冲回弹（0.18s）：目标 Block 轻微过冲后回弹，模拟拨码轮惯性
 *
 * 触发：wheel / touch / keyboard，scroll-snap 锁定每个 Block
 */
export default function SlotWheelTransition({ children }: SlotWheelTransitionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const currentIndex = useRef(0);
  const isAnimating = useRef(false);
  const wheelLockRef = useRef(0);
  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTime = useRef(0);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  // Landing 未就绪时锁定滚动，防止黑屏切换
  const landingReadyRef = useRef(false);

  const [activeIndex, setActiveIndex] = useState(0);

  const blocks = Children.toArray(children);
  const totalBlocks = blocks.length;

  // ---- 核心切换函数 ----
  const goToSection = (targetIndex: number) => {
    if (isAnimating.current) return;
    if (targetIndex < 0 || targetIndex >= totalBlocks) return;
    if (targetIndex === currentIndex.current) return;

    // 灯箱打开时禁止切换
    if (document.querySelector('[data-slot-lightbox]')) return;

    isAnimating.current = true;

    const direction = targetIndex > currentIndex.current ? 1 : -1;
    const currentSection = sectionsRef.current[currentIndex.current];
    const targetSection = sectionsRef.current[targetIndex];

    if (!currentSection || !targetSection) {
      isAnimating.current = false;
      return;
    }

    if (timelineRef.current) {
      timelineRef.current.kill();
    }

    const tl = gsap.timeline({
      onComplete: () => {
        currentIndex.current = targetIndex;
        setActiveIndex(targetIndex);
        // 短暂冷却，防止触摸/键盘连触发
        setTimeout(() => {
          isAnimating.current = false;
        }, 100);
      },
    });
    timelineRef.current = tl;

    if (direction === 1) {
      // 向下切换：当前 Block 向上翻出，目标 Block 从下方滚入
      // 蓄力段（0.1s）：当前 Block 微动，给一点机械阻力感
      tl.to(currentSection, {
        yPercent: -1,
        duration: 0.1,
        ease: 'sine.in',
      });
      // 释放段（0.4s）：当前 Block 加速翻出
      tl.to(currentSection, {
        yPercent: -100,
        duration: 0.4,
        ease: 'power2.in',
      });
      // 目标 Block 从下方快速滚入（power3.out 起步快，不会出现空档黑屏）
      // y:0 确保不残留像素位移，只用 yPercent 做百分比动画
      tl.fromTo(
        targetSection,
        { y: 0, yPercent: 100 },
        {
          y: 0,
          yPercent: 0,
          duration: 0.4,
          ease: 'power3.out',
        },
        0.1,
      );
      // 过冲回弹（0.18s）：模拟拨码轮惯性
      tl.to(targetSection, {
        yPercent: -1.5,
        duration: 0.08,
        ease: 'power2.out',
      });
      tl.to(targetSection, {
        yPercent: 0,
        duration: 0.1,
        ease: 'power2.inOut',
      });
    } else {
      // 向上切换：当前 Block 向下翻出，目标 Block 从上方滚入
      tl.to(currentSection, {
        yPercent: 1,
        duration: 0.1,
        ease: 'sine.in',
      });
      tl.to(currentSection, {
        yPercent: 100,
        duration: 0.4,
        ease: 'power2.in',
      });
      tl.fromTo(
        targetSection,
        { y: 0, yPercent: -100 },
        {
          y: 0,
          yPercent: 0,
          duration: 0.4,
          ease: 'power3.out',
        },
        0.1,
      );
      tl.to(targetSection, {
        yPercent: 1.5,
        duration: 0.08,
        ease: 'power2.out',
      });
      tl.to(targetSection, {
        yPercent: 0,
        duration: 0.1,
        ease: 'power2.inOut',
      });
    }
  };

  // 用 ref 存储最新函数，事件监听器始终调用最新版本
  const goToSectionRef = useRef(goToSection);
  goToSectionRef.current = goToSection;

  // ---- 初始化位置 ----
  // 用 useLayoutEffect 在首次绘制前定位，配合 CSS visibility:hidden 防止闪烁
  // 必须显式设 y:0 清除像素位移，否则 GSAP 可能残留 y 像素值导致双重位移
  useLayoutEffect(() => {
    const sections = sectionsRef.current.filter(Boolean) as HTMLDivElement[];
    sections.forEach((section, index) => {
      gsap.set(section, {
        y: 0,
        yPercent: index === 0 ? 0 : 100,
        visibility: 'visible',
      });
    });
  }, []);

  // ---- 监听 Landing 就绪事件 ----
  // Landing 的黑色遮罩淡出时才允许滚动切换，防止黑屏
  useEffect(() => {
    const handleReady = () => {
      landingReadyRef.current = true;
    };
    window.addEventListener('landing-ready', handleReady);
    return () => window.removeEventListener('landing-ready', handleReady);
  }, []);

  // ---- Wheel 事件 ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      // 灯箱打开时不处理
      if (document.querySelector('[data-slot-lightbox]')) return;

      // Landing 未就绪时禁止切换（防止黑屏）
      if (!landingReadyRef.current) return;

      // 检查当前 section 内是否有 Gallery 横向滚动区域
      // Gallery 横向滚动优先，不受 wheel lock 限制
      const currentSection = sectionsRef.current[currentIndex.current];
      const galleryEl = currentSection?.querySelector(
        '[data-slot-gallery]',
      ) as HTMLDivElement | null;

      if (galleryEl) {
        const canScrollRight =
          galleryEl.scrollLeft < galleryEl.scrollWidth - galleryEl.clientWidth - 1;
        const canScrollLeft = galleryEl.scrollLeft > 1;

        if (e.deltaY > 0 && canScrollRight) {
          galleryEl.scrollLeft += e.deltaY;
          return;
        }
        if (e.deltaY < 0 && canScrollLeft) {
          galleryEl.scrollLeft += e.deltaY;
          return;
        }
      }

      // wheel lock 期间忽略（吸收触控板惯性）
      if (Date.now() < wheelLockRef.current) return;
      if (isAnimating.current) return;

      // 首次有效滚动立即触发，不累积 delta
      if (Math.abs(e.deltaY) > 5) {
        if (e.deltaY > 0) {
          goToSectionRef.current(currentIndex.current + 1);
        } else {
          goToSectionRef.current(currentIndex.current - 1);
        }
        // 锁定 900ms 吸收触控板惯性余波
        wheelLockRef.current = Date.now() + 900;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // ---- Touch 事件 ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
      touchStartTime.current = Date.now();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (document.querySelector('[data-slot-lightbox]')) return;
      if (isAnimating.current) return;
      // Landing 未就绪时禁止切换（防止黑屏）
      if (!landingReadyRef.current) return;

      const endY = e.changedTouches[0].clientY;
      const endX = e.changedTouches[0].clientX;
      const deltaY = touchStartY.current - endY;
      const deltaX = touchStartX.current - endX;
      const elapsed = Date.now() - touchStartTime.current;

      // 只处理纵向滑动（deltaY 须占主导且足够长）
      if (Math.abs(deltaY) < 50 || Math.abs(deltaY) < Math.abs(deltaX) * 1.5) return;
      if (elapsed > 800) return;

      if (deltaY > 0) {
        goToSectionRef.current(currentIndex.current + 1);
      } else {
        goToSectionRef.current(currentIndex.current - 1);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // ---- 键盘事件 ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[data-slot-lightbox]')) return;
      if (isAnimating.current) return;
      // Landing 未就绪时禁止切换（防止黑屏）
      if (!landingReadyRef.current) return;

      switch (e.key) {
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          goToSectionRef.current(currentIndex.current + 1);
          break;
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          goToSectionRef.current(currentIndex.current - 1);
          break;
        case 'Home':
          e.preventDefault();
          goToSectionRef.current(0);
          break;
        case 'End':
          e.preventDefault();
          goToSectionRef.current(totalBlocks - 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalBlocks]);

  // ---- 清理 ----
  useEffect(() => {
    return () => {
      if (timelineRef.current) {
        timelineRef.current.kill();
      }
    };
  }, []);

  // activeIndex 仅用于潜在的外部读取，不参与渲染逻辑
  void activeIndex;

  return (
    <div ref={containerRef} className={styles.container}>
      {blocks.map((block, index) => (
        <div
          key={index}
          ref={(el) => {
            sectionsRef.current[index] = el;
          }}
          className={`${styles.section} ${index !== 0 ? 'skipWhenOffscreen' : ''}`}
        >
          {block}
        </div>
      ))}
    </div>
  );
}
