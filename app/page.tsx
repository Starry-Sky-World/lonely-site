import Landing from "@/components/Landing";
import Gallery from "@/components/Gallery";
import Footer from "@/components/Footer";
import BlockScaleWrapper from "@/components/BlockScaleWrapper";
import SlotWheelTransition from "@/components/SlotWheelTransition";

export default function Home() {
  return (
    <main className="w-full bg-ink">
      <SlotWheelTransition>
        {/* Block 1: Landing */}
        <BlockScaleWrapper designHeight={1024} origin="center" mode="cover" backgroundColor="#101010">
          <Landing />
        </BlockScaleWrapper>

        {/* Block 2: Gallery（首页只显示 3 张，完整版见 /gallery） */}
        <Gallery limit={3} />

        {/* Block 3: Footer（单独做响应式，确保 Lonely 大字和联系信息都可见） */}
        <Footer />
      </SlotWheelTransition>
    </main>
  );
}
